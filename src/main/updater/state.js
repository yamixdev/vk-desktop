export const UPDATE_PHASES = Object.freeze({
  IDLE: 'idle',
  CHECKING: 'checking',
  CURRENT: 'current',
  AVAILABLE: 'available',
  DOWNLOADING: 'downloading',
  DOWNLOADED: 'downloaded',
  ERROR: 'error'
});

export function createUpdaterState() {
  return {
    phase: UPDATE_PHASES.IDLE,
    manual: false,
    progress: 0,
    error: null,
    lastCheck: null
  };
}

export function getAvailableUpdateVersion(state, latestVersion = null) {
  if (state?.lastCheck?.status !== 'update-available') return null;

  const version = typeof latestVersion === 'string' && latestVersion.trim()
    ? latestVersion.trim()
    : state.lastCheck.remoteVersion;
  return typeof version === 'string' && version.trim() ? version.trim() : null;
}

function createLastCheck(event, status) {
  return {
    status,
    checkedAt: event.checkedAt ?? null,
    currentVersion: event.currentVersion ?? null,
    remoteVersion: event.remoteVersion ?? null,
    reason: event.reason ?? null,
    error: event.error ?? null
  };
}

export function transitionUpdaterState(state, event) {
  switch (event.type) {
    case 'CHECK_STARTED':
      if (state.phase === UPDATE_PHASES.CHECKING || state.phase === UPDATE_PHASES.DOWNLOADING) return state;
      return {
        ...state,
        phase: UPDATE_PHASES.CHECKING,
        manual: Boolean(event.manual),
        progress: 0,
        error: null
      };
    case 'CHECK_PROMOTED':
      if (state.phase !== UPDATE_PHASES.CHECKING) return state;
      return { ...state, manual: true };
    case 'UPDATE_AVAILABLE':
      return {
        ...state,
        phase: UPDATE_PHASES.AVAILABLE,
        error: null,
        lastCheck: createLastCheck(event, 'update-available')
      };
    case 'NO_UPDATE':
      return {
        ...state,
        phase: UPDATE_PHASES.CURRENT,
        manual: false,
        progress: 0,
        error: null,
        lastCheck: createLastCheck(event, 'current')
      };
    case 'DOWNLOAD_STARTED':
      return { ...state, phase: UPDATE_PHASES.DOWNLOADING, progress: 0, error: null };
    case 'DOWNLOAD_PROGRESS':
      if (state.phase !== UPDATE_PHASES.DOWNLOADING) return state;
      return { ...state, progress: Math.max(0, Math.min(100, Number(event.progress) || 0)) };
    case 'DOWNLOADED':
      return { ...state, phase: UPDATE_PHASES.DOWNLOADED, progress: 100, error: null };
    case 'ERROR':
      return {
        ...state,
        phase: UPDATE_PHASES.ERROR,
        progress: 0,
        error: event.error ?? 'Unknown error',
        lastCheck: event.checkedAt
          ? createLastCheck(event, 'error')
          : state.lastCheck
      };
    case 'CANCELLED':
      return {
        ...state,
        phase: state.lastCheck?.status === 'update-available'
          ? UPDATE_PHASES.AVAILABLE
          : UPDATE_PHASES.IDLE,
        manual: false,
        progress: 0,
        error: null
      };
    case 'RESET':
      return {
        ...state,
        phase: UPDATE_PHASES.IDLE,
        manual: false,
        progress: 0,
        error: null
      };
    case 'CLEAR':
      return createUpdaterState();
    default:
      return state;
  }
}
