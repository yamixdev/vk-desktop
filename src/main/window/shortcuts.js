const MIN_ZOOM_LEVEL = -3.8;
const MAX_ZOOM_LEVEL = 6;
const ZOOM_STEP = 0.5;

export const WINDOW_SHORTCUTS = Object.freeze({
  ZOOM_IN: 'zoom-in',
  ZOOM_OUT: 'zoom-out',
  ZOOM_RESET: 'zoom-reset',
  RELOAD: 'reload',
  HARD_RELOAD: 'hard-reload'
});

export function classifyWindowShortcut(input) {
  if (input?.type !== 'keyDown' || input.isComposing || input.alt) return null;
  if (!input.control && !input.meta) return null;

  const code = input.code;
  if (code === 'Equal' || code === 'NumpadAdd' || input.key === '+') {
    return WINDOW_SHORTCUTS.ZOOM_IN;
  }
  if (code === 'Minus' || code === 'NumpadSubtract' || input.key === '-') {
    return WINDOW_SHORTCUTS.ZOOM_OUT;
  }
  if (code === 'Digit0' || code === 'Numpad0') return WINDOW_SHORTCUTS.ZOOM_RESET;
  if (code === 'KeyR') {
    return input.shift ? WINDOW_SHORTCUTS.HARD_RELOAD : WINDOW_SHORTCUTS.RELOAD;
  }
  if (code === 'F5') return WINDOW_SHORTCUTS.HARD_RELOAD;
  return null;
}

function clampZoomLevel(level) {
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level));
}

export function applyWindowShortcut(webContents, shortcut) {
  switch (shortcut) {
    case WINDOW_SHORTCUTS.ZOOM_IN:
      webContents.setZoomLevel(clampZoomLevel(webContents.getZoomLevel() + ZOOM_STEP));
      break;
    case WINDOW_SHORTCUTS.ZOOM_OUT:
      webContents.setZoomLevel(clampZoomLevel(webContents.getZoomLevel() - ZOOM_STEP));
      break;
    case WINDOW_SHORTCUTS.ZOOM_RESET:
      webContents.setZoomLevel(0);
      break;
    case WINDOW_SHORTCUTS.RELOAD:
      webContents.reload();
      break;
    case WINDOW_SHORTCUTS.HARD_RELOAD:
      webContents.reloadIgnoringCache();
      break;
    default:
      return false;
  }
  return true;
}

export function installWindowShortcuts(webContents) {
  const onBeforeInput = (event, input) => {
    const shortcut = classifyWindowShortcut(input);
    if (!shortcut) return;
    event.preventDefault();
    applyWindowShortcut(webContents, shortcut);
  };
  webContents.on('before-input-event', onBeforeInput);
  return () => webContents.removeListener('before-input-event', onBeforeInput);
}
