param(
  [ValidateSet('idle', 'playback', 'tray')]
  [string]$Scenario = 'idle',

  [ValidateSet('on', 'off')]
  [string]$VKNext = 'on',

  [ValidateRange(0, 3600)]
  [int]$WarmupSeconds = 600,

  [ValidateRange(15, 1800)]
  [int]$MeasureSeconds = 60,

  [ValidateRange(1, 10)]
  [int]$Runs = 3,

  [string]$OutputDirectory = 'benchmark-results'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$electronExecutable = Join-Path $projectRoot 'node_modules/electron/dist/electron.exe'
if (-not (Test-Path -LiteralPath $electronExecutable)) {
  & npm.cmd --prefix $projectRoot run electron:ensure
  if ($LASTEXITCODE -ne 0) {
    throw "Electron binary installation failed with exit code $LASTEXITCODE."
  }
}
$electronPath = (Resolve-Path $electronExecutable).Path
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
$projectPrefix = $projectRoot.TrimEnd('\') + '\'
if (-not $outputRoot.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Output directory must stay inside the project: $outputRoot"
}
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

function Get-ProcessTree {
  param([int]$RootPid)
  $all = @(Get-CimInstance Win32_Process)
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootPid)
  do {
    $added = $false
    foreach ($process in $all) {
      if ($ids.Contains([int]$process.ParentProcessId) -and -not $ids.Contains([int]$process.ProcessId)) {
        [void]$ids.Add([int]$process.ProcessId)
        $added = $true
      }
    }
  } while ($added)
  return [pscustomobject]@{ All = $all; Ids = @($ids) }
}

function Stop-BenchmarkTree {
  param([int]$RootPid)
  $tree = Get-ProcessTree -RootPid $RootPid
  $targets = @($tree.All | Where-Object { $tree.Ids -contains [int]$_.ProcessId })
  foreach ($target in $targets) {
    if (-not $target.ExecutablePath -or -not $target.ExecutablePath.StartsWith((Split-Path $electronPath), [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to stop unexpected process $($target.ProcessId): $($target.ExecutablePath)"
    }
  }
  $targets | Sort-Object ProcessId -Descending | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Get-Median {
  param([double[]]$Values)
  $sorted = @($Values | Sort-Object)
  if ($sorted.Count -eq 0) { return 0 }
  $middle = [math]::Floor($sorted.Count / 2)
  if ($sorted.Count % 2 -eq 1) { return $sorted[$middle] }
  return ($sorted[$middle - 1] + $sorted[$middle]) / 2
}

$logicalProcessors = [Environment]::ProcessorCount
$runResults = @()

for ($run = 1; $run -le $Runs; $run++) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $metricsPath = Join-Path $outputRoot "$Scenario-vknext-$VKNext-run-$run-$stamp.jsonl"
  $arguments = @(
    '.',
    '--benchmark',
    "--vk-next=$VKNext",
    "--benchmark-output=$metricsPath"
  )
  $rootProcess = Start-Process -FilePath $electronPath -ArgumentList $arguments -WorkingDirectory $projectRoot -PassThru

  try {
    Start-Sleep -Seconds $WarmupSeconds
    if (-not (Get-Process -Id $rootProcess.Id -ErrorAction SilentlyContinue)) {
      throw 'VK Desktop exited during benchmark warmup.'
    }

    $samples = @()
    $sampleCount = [math]::Ceiling($MeasureSeconds / 5)
    for ($sampleIndex = 0; $sampleIndex -lt $sampleCount; $sampleIndex++) {
      $treeBefore = Get-ProcessTree -RootPid $rootProcess.Id
      $cpuBefore = @{}
      foreach ($id in $treeBefore.Ids) {
        $process = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($process) { $cpuBefore[$id] = $process.TotalProcessorTime.TotalSeconds }
      }
      $started = Get-Date
      Start-Sleep -Seconds 5
      $treeAfter = Get-ProcessTree -RootPid $rootProcess.Id
      $elapsed = ((Get-Date) - $started).TotalSeconds
      $workingBytes = 0L
      $commitBytes = 0L
      $cpuSeconds = 0.0

      foreach ($id in $treeAfter.Ids) {
        $process = Get-Process -Id $id -ErrorAction SilentlyContinue
        if (-not $process) { continue }
        $workingBytes += $process.WorkingSet64
        $commitBytes += $process.PrivateMemorySize64
        if ($cpuBefore.ContainsKey($id)) {
          $cpuSeconds += [math]::Max(0, $process.TotalProcessorTime.TotalSeconds - $cpuBefore[$id])
        }
      }

      $privateWorkingBytes = 0L
      $matchedCounterCount = 0
      Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object {
        if ($treeAfter.Ids -contains [int]$_.IDProcess) {
          $privateWorkingBytes += [int64]$_.WorkingSetPrivate
          $matchedCounterCount += 1
        }
      }
      if ($matchedCounterCount -eq 0) {
        throw 'Windows private working-set counters are unavailable.'
      }

      $samples += [pscustomobject]@{
        WorkingMb = [math]::Round($workingBytes / 1MB, 2)
        PrivateWorkingMb = [math]::Round($privateWorkingBytes / 1MB, 2)
        CommitMb = [math]::Round($commitBytes / 1MB, 2)
        CpuPercent = [math]::Round($cpuSeconds / $elapsed / $logicalProcessors * 100, 3)
        ProcessCount = $treeAfter.Ids.Count
      }
    }

    $runResult = [pscustomobject]@{
      Run = $run
      WorkingMb = [math]::Round((Get-Median -Values @($samples.WorkingMb)), 2)
      PrivateWorkingMb = [math]::Round((Get-Median -Values @($samples.PrivateWorkingMb)), 2)
      CommitMb = [math]::Round((Get-Median -Values @($samples.CommitMb)), 2)
      CpuPercent = [math]::Round((Get-Median -Values @($samples.CpuPercent)), 3)
      ProcessCount = [math]::Round((Get-Median -Values @($samples.ProcessCount)), 0)
      MetricsPath = $metricsPath
    }
    $runResults += $runResult
    $runResult | Format-List
  } finally {
    if (Get-Process -Id $rootProcess.Id -ErrorAction SilentlyContinue) {
      Stop-BenchmarkTree -RootPid $rootProcess.Id
    }
  }
}

$summary = [pscustomobject]@{
  Scenario = $Scenario
  VKNext = $VKNext
  WarmupSeconds = $WarmupSeconds
  MeasureSeconds = $MeasureSeconds
  Runs = $Runs
  MedianWorkingMb = [math]::Round((Get-Median -Values @($runResults.WorkingMb)), 2)
  MedianPrivateWorkingMb = [math]::Round((Get-Median -Values @($runResults.PrivateWorkingMb)), 2)
  MedianCommitMb = [math]::Round((Get-Median -Values @($runResults.CommitMb)), 2)
  MedianCpuPercent = [math]::Round((Get-Median -Values @($runResults.CpuPercent)), 3)
  Results = $runResults
}
$summaryPath = Join-Path $outputRoot "$Scenario-vknext-$VKNext-summary-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding utf8
$summary | Format-List
Write-Host "Summary: $summaryPath"
