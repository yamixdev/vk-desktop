import path from 'node:path';
import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import builderUtilRuntime from 'builder-util-runtime';
import logger from 'electron-log';
import { IPC_CHANNELS } from '../shared/ipcSchemas.js';
import {
  createUpdaterState,
  transitionUpdaterState,
  UPDATE_PHASES
} from './updater/state.js';
import {
  checkLatestGitHubRelease,
  isFreshCurrentCheck,
  RELEASE_CHECK_REASON,
  RELEASE_CHECK_STATUS
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
let updatePromptPromise = null;

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
    availableVersion: latestUpdateInfo?.version ?? updaterState.lastCheck?.remoteVersion ?? null,
    error: updaterState.phase === UPDATE_PHASES.ERROR ? updaterState.error : null,
    runtimeSupported: isUpdaterRuntimeSupported()
  };
}

export function sendUpdaterState(window = getMainWindow()) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.UPDATE_STATE, getUpdaterSnapshot());
}

function isUnpackedBuild() {
  if (process.platform !== 'win32') return false;
  return path.basename(path.dirname(process.execPath)).toLowerCase() === 'win-unpacked';
}

function isUpdaterRuntimeSupported() {
  return app.isPackaged && !isUnpackedBuild();
}

function getCheckedAtLabel(checkedAt) {
  const timestamp = Date.parse(checkedAt);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('ru-RU')
    : null;
}

async function showUpdaterUnavailable(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Обновления',
    message: 'Проверка обновлений доступна только в установленной сборке.',
    detail: isUnpackedBuild()
      ? 'В каталоге win-unpacked автообновление отключено. Для проверки и установки используй NSIS-версию.'
      : undefined,
    buttons: ['ОК'],
    noLink: true
  });
}

async function showCurrentVersionStatus(mainWindow, lastCheck) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  let message = 'Установлена последняя версия.';
  if (lastCheck.reason === RELEASE_CHECK_REASON.LOCAL_NEWER) {
    message = 'Установлена актуальная или более новая версия.';
  } else if (lastCheck.reason === RELEASE_CHECK_REASON.NO_RELEASE) {
    message = 'Опубликованных обновлений пока нет.';
  }

  const detail = [
    `Установленная версия: ${lastCheck.currentVersion ?? app.getVersion()}`,
    lastCheck.remoteVersion ? `Последний релиз: ${lastCheck.remoteVersion}` : null,
    getCheckedAtLabel(lastCheck.checkedAt)
      ? `Проверено: ${getCheckedAtLabel(lastCheck.checkedAt)}`
      : null
  ].filter(Boolean).join('\n');

  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Обновления',
    message,
    detail,
    buttons: ['ОК'],
    noLink: true
  });
}

async function showManualCheckError(mainWindow, error) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'Ошибка обновления',
    message: 'Не удалось проверить обновления.',
    detail: error?.message ?? 'Неизвестная ошибка.',
    buttons: ['ОК'],
    noLink: true
  });
}

async function runReleasePreflight() {
  if (
    latestReleaseResult
    && Date.now() - latestReleaseCheckedAt <= MANUAL_RELEASE_DETAILS_CACHE_MS
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
        signal: controller.signal
      });
      latestReleaseResult = result;
      latestReleaseCheckedAt = Date.now();
      return result;
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

export async function getReleaseNotesDetails() {
  try {
    const result = await runReleasePreflight();
    return {
      currentVersion: app.getVersion(),
      status: result.status,
      reason: result.reason,
      release: result.release ?? null,
      error: null
    };
  } catch (error) {
    logger.warn('[Updater] Could not load release notes:', error);
    return {
      currentVersion: app.getVersion(),
      status: RELEASE_CHECK_STATUS.ERROR,
      reason: error?.code ?? 'release-notes-failed',
      release: latestReleaseResult?.release ?? null,
      error: 'Не удалось загрузить описание релиза.'
    };
  }
}

async function completeNoUpdate(result) {
  const shouldNotify = updaterState.manual;
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

  if (shouldNotify) {
    await showCurrentVersionStatus(getMainWindow(), updaterState.lastCheck);
  }
  return updaterState;
}

async function recordCheckFailure(error) {
  const shouldNotify = updaterState.manual;
  const checkedAt = new Date().toISOString();
  setState({
    type: 'ERROR',
    checkedAt,
    currentVersion: app.getVersion(),
    remoteVersion: null,
    reason: error?.code ?? 'check-failed',
    error: error?.message
  });
  logger.warn('[Updater] Update check failed:', error);
  if (shouldNotify) await showManualCheckError(getMainWindow(), error);
  return updaterState;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim();
}

function getReleaseNotes(info) {
  if (typeof info.releaseNotes === 'string') return stripHtml(info.releaseNotes);
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes.map((entry) => stripHtml(entry?.note)).filter(Boolean).join('\n');
  }
  return 'Исправления ошибок и улучшения.';
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
        setState({ type: 'ERROR', error: error.message });
        dialog.showErrorBox('Ошибка обновления', 'Не удалось загрузить обновление.');
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

async function showDownloadedUpdatePrompt() {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return updaterState;

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Обновление готово',
    message: 'Перезапустить VK Desktop и установить обновление?',
    buttons: ['Перезапустить', 'Позже'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (response === 0) {
    installDownloadedUpdate();
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

  const mainWindow = getMainWindow();
  if (!isUpdaterRuntimeSupported()) {
    if (manual) await showUpdaterUnavailable(mainWindow);
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
    if (manual) await showDownloadedUpdatePrompt();
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
    await showCurrentVersionStatus(mainWindow, updaterState.lastCheck);
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

async function onUpdateAvailable(info) {
  latestUpdateInfo = info;
  setState({
    type: 'UPDATE_AVAILABLE',
    checkedAt: new Date().toISOString(),
    currentVersion: app.getVersion(),
    remoteVersion: info?.version ?? null,
    reason: RELEASE_CHECK_REASON.REMOTE_NEWER
  });

  if (updatePromptPromise) return updatePromptPromise;

  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return updaterState;
  }

  const promptTask = (async () => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Обновление',
      message: `Доступна версия ${info.version}`,
      detail: getReleaseNotes(info).slice(0, 4000),
      buttons: ['Скачать', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (disposed) return updaterState;
    if (response === 0) await startDownload();
    return updaterState;
  });
  updatePromptPromise = promptTask();
  try {
    return await updatePromptPromise;
  } finally {
    updatePromptPromise = null;
  }
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

async function onUpdateDownloaded() {
  if (downloadCancellationRequested || updaterState.phase !== UPDATE_PHASES.DOWNLOADING) return;
  cancellationToken = null;
  downloadCancellationRequested = false;
  downloadErrorHandled = false;
  setState({ type: 'DOWNLOADED' });
  clearDownloadProgress();
  await showDownloadedUpdatePrompt();
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
    setState({ type: 'ERROR', error: error?.message });
    cancellationToken = null;
    clearDownloadProgress();
    dialog.showErrorBox('Ошибка обновления', 'Не удалось загрузить обновление.');
    return;
  }

  if (updaterState.phase === UPDATE_PHASES.DOWNLOADED) {
    app.isQuitting = false;
    logger.error('[Updater] Could not start the downloaded update installer:', error);
    dialog.showErrorBox('Ошибка обновления', 'Не удалось запустить установщик обновления.');
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
  latestUpdateInfo = null;
  latestReleaseResult = null;
  latestReleaseCheckedAt = 0;
  updatePromptPromise = null;
  checkErrorHandled = false;
  setState({ type: 'CLEAR' });
  initialized = false;
}
