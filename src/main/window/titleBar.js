export const TITLE_BAR_HEIGHT = 48;

const TITLE_BAR_PALETTES = Object.freeze({
  light: Object.freeze({
    color: '#f0f2f5',
    symbolColor: '#141414'
  }),
  dark: Object.freeze({
    color: '#19191a',
    symbolColor: '#f2f3f5'
  })
});

export function normalizeTitleBarTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light';
}

export function createTitleBarOverlay(theme) {
  const palette = TITLE_BAR_PALETTES[normalizeTitleBarTheme(theme)];
  return {
    ...palette,
    height: TITLE_BAR_HEIGHT
  };
}

export function applyTitleBarTheme(window, theme) {
  if (process.platform === 'darwin' || !window || window.isDestroyed()) return;
  window.setTitleBarOverlay(createTitleBarOverlay(theme));
}
