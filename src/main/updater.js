import path from 'node:path';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import builderUtilRuntime from 'builder-util-runtime';
import logger from 'electron-log';
import { IPC_CHANNELS } from '../shared/ipcSchemas.js';
import {
  createUpdaterState,
  getAvailableUpdateVersion,
  transitionUpdaterState,
  UPDATE_PHASES
} from './updater/state.js';
import {
  checkLatestGitHubRelease,
  compareReleaseVersions,
  getGitHubReleaseByTag,
  isFreshCurrentCheck,
  RELEASE_CHECK_REASON,
  RELEASE_CHECK_STATUS,
  ReleaseCheckError,
  GITHUB_RELEASES_PAGE_URL
} from './updater/releasePolicy.js';

const { autoUpdater } = electronUpdater;
const { CancellationToken } = builderUtilRuntime;
const STARTUP_CHECK_DELAY_MS = 15000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASE_CHECK_TIMEOUT_MS = 10000;

logger.transports.file.level = 'info';
autoUpdater.logger = logger;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.autoRunAppAfterInstall = true;
autoUpdater.allowDowngrade = false;

let initialized = false;
let disposed = false;
let getMainWindow = () => null;
let updaterState = createUpdaterState();
let startupTimer = null;
let periodicTimer = null;
let activeCheckTask = null;
let activeReleaseCheckTask = null;
let releaseCheckController = null;
let checkErrorHandled = false;
let cancellationToken = null;
let activeDownloadTask = null;
let downloadCancellationRequested = false;
let downloadErrorHandled = false;
let latestProgress = { percent: 0, speed: '—' };
let latestUpdateInfo = null;
let latestReleaseResult = null;
let latestReleaseCheckedAt = 0;
let latestReleaseEtag = null;
let releaseCheckBlockedUntil = 0;
let installedRelease = null;
let installedReleaseCheckedAt = 0;
let activeInstalledReleaseTask = null;

function setState(event) {
  updaterState = transitionUpdaterState(updaterState, event);
  sendUpdaterState();
  return updaterState;
}

export function getUpdaterSnapshot() {
  return {
    phase: updaterState.phase,
    progress: Math.round(updaterState.progress),
    speed: latestProgress.speed,
    currentVersion: app.getVersion(),
    availableVersion: getAvailableUpdateVersion(updaterState, latestUpdateInfo?.version),
    error: updaterState.phase === UPDATE_PHASES.ERROR ? updaterState.error : null,
    runtimeSupported: isUpdaterRuntimeSupported()
  };
}

export function sendUpdaterState(window = getMainWindow()) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.UPDATE_STATE, getUpdaterSnapshot());
}

function openUpdateDialog(view = 'update', window = getMainWindow()) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.UPDATE_OPEN_DIALOG, { view });
}

function rememberRateLimit(error) {
  if (error?.code !== 'RATE_LIMITED' || !Number.isFinite(error.retryAfterMs)) return;
  releaseCheckBlockedUntil = Math.max(
    releaseCheckBlockedUntil,
    Date.now() + Math.max(0, error.retryAfterMs)
  );
}

function isUnpackedBuild() {
  if (process.platform !== 'win32') return false;
  return path.basename(path.dirname(process.execPath)).toLowerCase() === 'win-unpacked';
}

function isUpdaterRuntimeSupported() {
  return app.isPackaged && !isUnpackedBuild();
}

function getUpdateErrorMessage(error) {
  const retryAfterMs = Number(error?.retryAfterMs);
  const retryAfterMinutes = Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.max(1, Math.ceil(retryAfterMs / 60_000))
    : null;
  if (error?.code === 'RATE_LIMITED') {
    return [
      'GitHub временно ограничил автоматическую проверку.',
      retryAfterMinutes
        ? `Повтори её примерно через ${retryAfterMinutes} мин.`
        : 'Повтори её немного позже.',
      'Актуальную версию можно скачать вручную на странице последних релизов.'
    ].join(' ');
  }
  if (error?.code === 'NETWORK_ERROR') {
    return 'Не удалось связаться с GitHub. Проверь подключение и попробуй снова.';
  }
  if (error?.code === 'TIMEOUT') {
    return 'GitHub слишком долго отвечает. Попробуй проверить обновления позже.';
  }
  return 'Не удалось проверить обновления. Попробуй ещё раз немного позже.';
}

async function runReleasePreflight() {
  const now = Date.now();
  if (releaseCheckBlockedUntil > now) {
    throw new ReleaseCheckError('GitHub API rate limit is still active.', {
      code: 'RATE_LIMITED',
      retryAfterMs: releaseCheckBlockedUntil - now
    });
  }
  if (
    latestReleaseResult
    && now - latestReleaseCheckedAt <= MANUAL_RELEASE_DETAILS_CACHE_MS
  ) {
    return latestReleaseResult;
  }
  if (activeReleaseCheckTask) return activeReleaseCheckTask;

  const task = (async () => {
    const controller = new AbortController();
    releaseCheckController = controller;
    const timeout = setTimeout(() => controller.abort(), RELEASE_CHECK_TIMEOUT_MS);
    timeout.unref?.();

    try {
      const result = await checkLatestGitHubRelease({
        currentVersion: app.getVersion(),
        signal: controller.signal,
        etag: latestReleaseEtag
      });
      if (result.status === RELEASE_CHECK_STATUS.NOT_MODIFIED) {
        if (!latestReleaseResult) {
          throw new ReleaseCheckError('GitHub returned an unexpected empty cache response.', {
            code: 'INVALID_RESPONSE'
          });
        }
        latestReleaseEtag = result.etag ?? latestReleaseEtag;
        latestReleaseCheckedAt = Date.now();
        return latestReleaseResult;
      }
      latestReleaseResult = result;
      latestReleaseEtag = result.etag ?? latestReleaseEtag;
      latestReleaseCheckedAt = Date.now();
      return result;
    } catch (error) {
      rememberRateLimit(error);
      throw error;
    } finally {
      clearTimeout(timeout);
      if (releaseCheckController === controller) releaseCheckController = null;
    }
  })();

  let trackedTask;
  trackedTask = task.finally(() => {
    if (activeReleaseCheckTask === trackedTask) activeReleaseCheckTask = null;
  });
  activeReleaseCheckTask = trackedTask;
  return trackedTask;
}

const MANUAL_RELEASE_DETAILS_CACHE_MS = 5 * 60 * 1000;

async function getInstalledReleaseDetails() {
  const now = Date.now();
  if (
    installedReleaseCheckedAt
    && now - installedReleaseCheckedAt <= MANUAL_RELEASE_DETAILS_CACHE_MS
  ) {
    return installedRelease;
  }
  if (activeInstalledReleaseTask) return activeInstalledReleaseTask;

  const task = (async () => {
    if (releaseCheckBlockedUntil > Date.now()) {
      throw new ReleaseCheckError('GitHub API rate limit is still active.', {
        code: 'RATE_LIMITED',
        retryAfterMs: releaseCheckBlockedUntil - Date.now()
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RELEASE_CHECK_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const release = await getGitHubReleaseByTag({
        version: app.getVersion(),
        signal: controller.signal
      });
      installedRelease = release;
      installedReleaseCheckedAt = Date.now();
      return release;
    } catch (error) {
      rememberRateLimit(error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  let trackedTask;
  trackedTask = task.finally(() => {
    if (activeInstalledReleaseTask === trackedTask) activeInstalledReleaseTask = null;
  });
  activeInstalledReleaseTask = trackedTask;
  return trackedTask;
}

export async function getReleaseNotesDetails({ view = 'current' } = {}) {
  if (!isUpdaterRuntimeSupported()) {
    return {
      currentVersion: app.getVersion(),
      availableVersion: null,
      view,
      status: RELEASE_CHECK_STATUS.ERROR,
      reason: 'UNSUPPORTED',
      release: null,
      releasesUrl: null,
      error: isUnpackedBuild()
        ? 'В сборке win-unpacked автообновление отключено. Установи NSIS-версию, чтобы получать обновления в приложении.'
        : 'Автообновление доступно только в установленной версии приложения.'
    };
  }

  try {
    if (view === 'current') {
      const release = await getInstalledReleaseDetails();
      return {
        currentVersion: app.getVersion(),
        availableVersion: null,
        view,
        status: RELEASE_CHECK_STATUS.CURRENT,
        reason: release ? RELEASE_CHECK_REASON.EQUAL : 'release-not-found',
        release,
        releasesUrl: release?.htmlUrl ?? GITHUB_RELEASES_PAGE_URL,
        error: null
      };
    }

    const result = await runReleasePreflight();
    const release = result.status === RELEASE_CHECK_STATUS.UPDATE_AVAILABLE
      ? result.release ?? null
      : null;
    return {
      currentVersion: app.getVersion(),
      availableVersion: result.status === RELEASE_CHECK_STATUS.UPDATE_AVAILABLE
        ? result.remoteVersion
        : null,
      view,
      status: result.status,
      reason: result.reason,
      release,
      releasesUrl: release?.htmlUrl ?? GITHUB_RELEASES_PAGE_URL,
      error: null
    };
  } catch (error) {
    logger.warn('[Updater] Could not load release notes:', error);
    const retryAfterMs = Number(error?.retryAfterMs);
    const rateLimited = error?.code === 'RATE_LIMITED';
    return {
      currentVersion: app.getVersion(),
      availableVersion: null,
      view,
      status: RELEASE_CHECK_STATUS.ERROR,
      reason: error?.code ?? 'release-notes-failed',
      release: latestReleaseResult?.release ?? null,
      releasesUrl: rateLimited ? GITHUB_RELEASES_PAGE_URL : null,
      error: getUpdateErrorMessage({ ...error, retryAfterMs })
    };
  }
}

async function completeNoUpdate(result) {
  const checkedAt = new Date().toISOString();
  setState({
    type: 'NO_UPDATE',
    checkedAt,
    currentVersion: result.currentVersion ?? app.getVersion(),
    remoteVersion: result.remoteVersion ?? null,
    reason: result.reason ?? RELEASE_CHECK_REASON.EQUAL
  });
  logger.info(
    `[Updater] No update required (current: ${result.currentVersion ?? app.getVersion()}, `
    + `latest: ${result.remoteVersion ?? 'none'}, reason: ${result.reason ?? 'unknown'}).`
  );

  return updaterState;
}

async function recordCheckFailure(error) {
  const checkedAt = new Date().toISOString();
  setState({
    type: 'ERROR',
    checkedAt,
    currentVersion: app.getVersion(),
    remoteVersion: null,
    reason: error?.code ?? 'check-failed',
    error: getUpdateErrorMessage(error)
  });
  logger.warn('[Updater] Update check failed:', error);
  return updaterState;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function clearDownloadProgress() {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
}

export function cancelUpdateDownload() {
  if (updaterState.phase !== UPDATE_PHASES.DOWNLOADING) return;
  downloadCancellationRequested = true;
  cancellationToken?.cancel();
  setState({ type: 'CANCELLED' });
  clearDownloadProgress();
}

async function startDownload() {
  const mainWindow = getMainWindow();
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || updaterState.phase !== UPDATE_PHASES.AVAILABLE
    || !latestUpdateInfo
  ) return updaterState;

  cancellationToken = new CancellationToken();
  downloadCancellationRequested = false;
  downloadErrorHandled = false;
  latestProgress = { percent: 0, speed: '—' };
  setState({ type: 'DOWNLOAD_STARTED' });

  const downloadTask = (async () => {
    try {
      await autoUpdater.downloadUpdate(cancellationToken);
    } catch (error) {
      const wasCancelled = disposed || downloadCancellationRequested || cancellationToken?.cancelled;
      if (wasCancelled) {
        if (!disposed) setState({ type: 'CANCELLED' });
      } else if (!downloadErrorHandled) {
        logger.error('[Updater] Update download failed:', error);
        setState({
          type: 'ERROR',
          error: 'Не удалось скачать обновление. Проверь подключение и попробуй снова.'
        });
        openUpdateDialog();
      }
      cancellationToken = null;
      downloadCancellationRequested = false;
      downloadErrorHandled = false;
      clearDownloadProgress();
    }
  })();
  let trackedTask;
  trackedTask = downloadTask.finally(() => {
    if (activeDownloadTask === trackedTask) activeDownloadTask = null;
  });
  activeDownloadTask = trackedTask;
  await trackedTask;
  return updaterState;
}

export function downloadAvailableUpdate() {
  return startDownload();
}

async function performUpdateCheck({ manual }) {
  setState({ type: 'CHECK_STARTED', manual });
  checkErrorHandled = false;

  try {
    const release = await runReleasePreflight();
    if (disposed) return updaterState;

    if (release.status === RELEASE_CHECK_STATUS.CURRENT) {
      return completeNoUpdate(release);
    }

    logger.info(
      `[Updater] Preflight found v${release.remoteVersion}; `
      + `starting electron-updater for local v${release.currentVersion}.`
    );
    const result = await autoUpdater.checkForUpdates();
    if (disposed) return updaterState;

    // electron-updater normally emits update-not-available before resolving.
    // Keep a fallback here so a provider response can never leave the state stuck.
    if (!result?.isUpdateAvailable && updaterState.phase === UPDATE_PHASES.CHECKING) {
      return completeNoUpdate({
        status: RELEASE_CHECK_STATUS.CURRENT,
        reason: RELEASE_CHECK_REASON.EQUAL,
        currentVersion: app.getVersion(),
        remoteVersion: result?.updateInfo?.version ?? release.remoteVersion
      });
    }
  } catch (error) {
    if (!disposed && !checkErrorHandled && updaterState.phase === UPDATE_PHASES.CHECKING) {
      await recordCheckFailure(error);
    }
  } finally {
    checkErrorHandled = false;
  }

  return updaterState;
}

export function installDownloadedUpdate() {
  if (updaterState.phase !== UPDATE_PHASES.DOWNLOADED) return false;
  logger.info('[Updater] User requested restart and update installation.');
  // quitAndInstall closes windows before Electron emits before-quit. Mark the
  // shutdown first so "minimize to tray" cannot cancel installation.
  app.isQuitting = true;
  autoUpdater.autoRunAppAfterInstall = true;
  try {
    if (process.platform === 'win32') autoUpdater.quitAndInstall(true, true);
    else autoUpdater.quitAndInstall();
    return true;
  } catch (error) {
    app.isQuitting = false;
    onUpdaterError(error);
    return false;
  }
}

async function checkForUpdates({ manual = false } = {}) {
  if (disposed) return updaterState;

  if (!isUpdaterRuntimeSupported()) {
    if (manual) {
      setState({
        type: 'ERROR',
        error: isUnpackedBuild()
          ? 'В сборке win-unpacked автообновление отключено. Установи NSIS-версию.'
          : 'Автообновление доступно только в установленной версии приложения.'
      });
    }
    return updaterState;
  }

  if (updaterState.phase === UPDATE_PHASES.CHECKING) {
    if (manual) setState({ type: 'CHECK_PROMOTED' });
    return activeCheckTask ?? updaterState;
  }

  if (updaterState.phase === UPDATE_PHASES.DOWNLOADING) {
    return updaterState;
  }

  if (updaterState.phase === UPDATE_PHASES.DOWNLOADED) {
    return updaterState;
  }

  if (
    manual
    && updaterState.lastCheck?.status === RELEASE_CHECK_STATUS.UPDATE_AVAILABLE
    && latestUpdateInfo
  ) {
    return onUpdateAvailable(latestUpdateInfo);
  }

  if (manual && isFreshCurrentCheck(updaterState.lastCheck)) {
    return updaterState;
  }

  const task = performUpdateCheck({ manual });
  let trackedTask;
  trackedTask = task.finally(() => {
    if (activeCheckTask === trackedTask) activeCheckTask = null;
  });
  activeCheckTask = trackedTask;
  return trackedTask;
}

function onUpdateAvailable(info) {
  let comparison;
  try {
    comparison = compareReleaseVersions(app.getVersion(), info?.version);
  } catch (error) {
    logger.warn('[Updater] Ignored update with an invalid version:', error);
    return updaterState;
  }

  if (comparison.status !== RELEASE_CHECK_STATUS.UPDATE_AVAILABLE) {
    logger.warn(
      `[Updater] Ignored non-newer update v${info?.version} for local v${app.getVersion()}.`
    );
    latestUpdateInfo = null;
    if (updaterState.phase === UPDATE_PHASES.CHECKING) void completeNoUpdate(comparison);
    return updaterState;
  }

  latestUpdateInfo = info;
  setState({
    type: 'UPDATE_AVAILABLE',
    checkedAt: new Date().toISOString(),
    currentVersion: app.getVersion(),
    remoteVersion: info?.version ?? null,
    reason: RELEASE_CHECK_REASON.REMOTE_NEWER
  });
  // Automatic checks only surface the amber title-bar action. A modal is
  // reserved for an explicit manual check or for the user's click on it.
  return updaterState;
}

function onDownloadProgress(progress) {
  if (updaterState.phase !== UPDATE_PHASES.DOWNLOADING) return;
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  latestProgress = {
    percent,
    speed: `${formatBytes(Number(progress.bytesPerSecond) || 0)}/с`
  };
  setState({ type: 'DOWNLOAD_PROGRESS', progress: percent });
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(percent / 100);
}

function onUpdateDownloaded() {
  if (downloadCancellationRequested || updaterState.phase !== UPDATE_PHASES.DOWNLOADING) return;
  cancellationToken = null;
  downloadCancellationRequested = false;
  downloadErrorHandled = false;
  setState({ type: 'DOWNLOADED' });
  clearDownloadProgress();
  openUpdateDialog();
}

function onUpdateNotAvailable(info) {
  void completeNoUpdate({
    status: RELEASE_CHECK_STATUS.CURRENT,
    reason: RELEASE_CHECK_REASON.EQUAL,
    currentVersion: app.getVersion(),
    remoteVersion: info?.version ?? null
  });
}

function onUpdaterError(error) {
  if (downloadCancellationRequested || cancellationToken?.cancelled) return;

  if (updaterState.phase === UPDATE_PHASES.CHECKING) {
    checkErrorHandled = true;
    void recordCheckFailure(error);
    return;
  }

  if (updaterState.phase === UPDATE_PHASES.DOWNLOADING) {
    downloadErrorHandled = true;
    logger.error('[Updater] Update download failed:', error);
    setState({
      type: 'ERROR',
      error: 'Не удалось скачать обновление. Проверь подключение и попробуй снова.'
    });
    cancellationToken = null;
    clearDownloadProgress();
    openUpdateDialog();
    return;
  }

  if (updaterState.phase === UPDATE_PHASES.DOWNLOADED) {
    app.isQuitting = false;
    logger.error('[Updater] Could not start the downloaded update installer:', error);
    setState({
      type: 'ERROR',
      error: 'Не удалось запустить установщик обновления. Попробуй скачать релиз вручную.'
    });
    openUpdateDialog();
    return;
  }

  logger.warn(`[Updater] Ignored updater error in phase "${updaterState.phase}":`, error);
}

export function initAutoUpdater(windowOrProvider) {
  getMainWindow = typeof windowOrProvider === 'function'
    ? windowOrProvider
    : () => windowOrProvider;
  if (initialized) return;

  initialized = true;
  disposed = false;
  autoUpdater.on('update-available', onUpdateAvailable);
  autoUpdater.on('download-progress', onDownloadProgress);
  autoUpdater.on('update-downloaded', onUpdateDownloaded);
  autoUpdater.on('update-not-available', onUpdateNotAvailable);
  autoUpdater.on('error', onUpdaterError);

  if (isUpdaterRuntimeSupported()) {
    startupTimer = setTimeout(() => void checkForUpdates(), STARTUP_CHECK_DELAY_MS);
    startupTimer.unref?.();
    periodicTimer = setInterval(() => void checkForUpdates(), PERIODIC_CHECK_INTERVAL_MS);
    periodicTimer.unref?.();
  } else if (app.isPackaged) {
    logger.info('[Updater] Automatic update checks are disabled for win-unpacked.');
  }
}

export function manualCheck(mainWindow) {
  if (mainWindow) getMainWindow = () => mainWindow;
  if (!initialized) initAutoUpdater(getMainWindow);
  openUpdateDialog();
  return checkForUpdates({ manual: true });
}

export async function disposeAutoUpdater() {
  if (!initialized) return;
  disposed = true;
  if (startupTimer) clearTimeout(startupTimer);
  if (periodicTimer) clearInterval(periodicTimer);
  startupTimer = null;
  periodicTimer = null;
  releaseCheckController?.abort();
  releaseCheckController = null;
  cancelUpdateDownload();
  clearDownloadProgress();
  if (activeDownloadTask) {
    let timeoutId;
    await Promise.race([
      activeDownloadTask,
      new Promise((resolve) => { timeoutId = setTimeout(resolve, 5000); })
    ]).finally(() => clearTimeout(timeoutId));
  }
  autoUpdater.removeListener('update-available', onUpdateAvailable);
  autoUpdater.removeListener('download-progress', onDownloadProgress);
  autoUpdater.removeListener('update-downloaded', onUpdateDownloaded);
  autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
  autoUpdater.removeListener('error', onUpdaterError);
  activeCheckTask = null;
  activeReleaseCheckTask = null;
  activeInstalledReleaseTask = null;
  latestUpdateInfo = null;
  latestReleaseResult = null;
  latestReleaseCheckedAt = 0;
  latestReleaseEtag = null;
  releaseCheckBlockedUntil = 0;
  installedRelease = null;
  installedReleaseCheckedAt = 0;
  checkErrorHandled = false;
  setState({ type: 'CLEAR' });
  initialized = false;
}
