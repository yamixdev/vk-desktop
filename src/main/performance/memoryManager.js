const CHECK_INTERVAL_MS = 60 * 1000;
const HIDDEN_GRACE_MS = 5 * 60 * 1000;
const COLLECTION_COOLDOWN_MS = 15 * 60 * 1000;

const PROFILE_PRIVATE_THRESHOLDS_KB = Object.freeze({
  powersave: 192 * 1024,
  balanced: 256 * 1024,
  performance: 384 * 1024
});

export function getPrivateThresholdKb(profile) {
  return PROFILE_PRIVATE_THRESHOLDS_KB[profile] ?? PROFILE_PRIVATE_THRESHOLDS_KB.balanced;
}

export function shouldCollectGarbage({
  now,
  hiddenSince,
  lastCollectionAt,
  visible,
  minimized,
  audible,
  mediaPlaying,
  loading,
  debuggerAttached,
  privateKb,
  profile
}) {
  if (visible && !minimized) return false;
  if (!Number.isFinite(hiddenSince) || now - hiddenSince < HIDDEN_GRACE_MS) return false;
  if (audible || mediaPlaying || loading || debuggerAttached) return false;
  if (Number.isFinite(lastCollectionAt) && now - lastCollectionAt < COLLECTION_COOLDOWN_MS) {
    return false;
  }
  return Number.isFinite(privateKb) && privateKb >= getPrivateThresholdKb(profile);
}

export class SmartMemoryManager {
  constructor({ app, mainWindow, getProfile }) {
    this.app = app;
    this.mainWindow = mainWindow;
    this.getProfile = getProfile;
    this.timer = null;
    this.hiddenSince = null;
    this.lastCollectionAt = null;
    this.mediaPlaying = false;
    this.collectionTask = null;
    this.disabled = false;
    this.onHidden = () => { this.hiddenSince ??= Date.now(); };
    this.onActive = () => { this.hiddenSince = null; };
  }

  start() {
    if (this.timer || this.mainWindow.isDestroyed()) return this;
    this.hiddenSince = this.mainWindow.isVisible() && !this.mainWindow.isMinimized()
      ? null
      : Date.now();
    this.mainWindow.on('hide', this.onHidden);
    this.mainWindow.on('minimize', this.onHidden);
    this.mainWindow.on('show', this.onActive);
    this.mainWindow.on('restore', this.onActive);
    this.mainWindow.on('focus', this.onActive);
    this.timer = setInterval(() => { void this.check(); }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
    return this;
  }

  updateMediaState(state) {
    this.mediaPlaying = state?.isPlaying === true;
  }

  async check() {
    if (this.disabled || this.collectionTask || this.mainWindow.isDestroyed()) return false;
    const contents = this.mainWindow.webContents;
    if (contents.isDestroyed() || contents.isCrashed()) return false;

    const now = Date.now();
    const profile = this.getProfile?.();
    const collectionState = {
      now,
      hiddenSince: this.hiddenSince,
      lastCollectionAt: this.lastCollectionAt,
      visible: this.mainWindow.isVisible(),
      minimized: this.mainWindow.isMinimized(),
      audible: contents.isCurrentlyAudible(),
      mediaPlaying: this.mediaPlaying,
      loading: contents.isLoadingMainFrame(),
      debuggerAttached: contents.debugger.isAttached() || contents.isDevToolsOpened(),
      profile
    };
    if (!shouldCollectGarbage({
      ...collectionState,
      privateKb: getPrivateThresholdKb(profile)
    })) return false;

    const rendererPid = contents.getOSProcessId();
    const rendererMetric = this.app.getAppMetrics().find((metric) => metric.pid === rendererPid);
    const privateKb = rendererMetric?.memory?.privateBytes;
    if (!Number.isFinite(privateKb) || privateKb < getPrivateThresholdKb(profile)) return false;

    this.lastCollectionAt = now;
    this.collectionTask = this.#collectRendererGarbage(contents, privateKb)
      .finally(() => { this.collectionTask = null; });
    return this.collectionTask;
  }

  async #collectRendererGarbage(contents, privateKb) {
    const debuggerClient = contents.debugger;
    let attached = false;
    try {
      debuggerClient.attach();
      attached = true;
      await debuggerClient.sendCommand('HeapProfiler.collectGarbage');
      console.log(`[Memory] Collected hidden renderer garbage at ${Math.round(privateKb / 1024)} MB private`);
      return true;
    } catch (error) {
      if (/not found|not supported|unknown method/iu.test(error.message)) this.disabled = true;
      console.warn('[Memory] Renderer garbage collection skipped:', error.message);
      return false;
    } finally {
      if (attached && debuggerClient.isAttached()) debuggerClient.detach();
    }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.removeListener('hide', this.onHidden);
      this.mainWindow.removeListener('minimize', this.onHidden);
      this.mainWindow.removeListener('show', this.onActive);
      this.mainWindow.removeListener('restore', this.onActive);
      this.mainWindow.removeListener('focus', this.onActive);
    }
    this.mediaPlaying = false;
  }
}
