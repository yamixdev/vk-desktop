const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function intersectsDisplay(bounds, display) {
  const area = display.workArea ?? display.bounds;
  if (!area) return false;

  const overlapWidth = Math.max(
    0,
    Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
  );

  return overlapWidth >= 64 && overlapHeight >= 64;
}

export function normalizeWindowState(state, displays, primaryWorkArea) {
  const source = state && typeof state === 'object' ? state : {};
  const fallback = primaryWorkArea ?? { width: 1280, height: 800 };
  const maxWidth = Math.max(MIN_WIDTH, fallback.width);
  const maxHeight = Math.max(MIN_HEIGHT, fallback.height);
  const width = clamp(Number.isFinite(source.width) ? source.width : Math.round(fallback.width * 0.8), MIN_WIDTH, maxWidth);
  const height = clamp(Number.isFinite(source.height) ? source.height : Math.round(fallback.height * 0.9), MIN_HEIGHT, maxHeight);

  const normalized = {
    width: Math.round(width),
    height: Math.round(height),
    isMaximized: source.isMaximized === true
  };

  if (Number.isFinite(source.x) && Number.isFinite(source.y)) {
    const candidate = { x: source.x, y: source.y, width, height };
    if (displays.some((display) => intersectsDisplay(candidate, display))) {
      normalized.x = Math.round(source.x);
      normalized.y = Math.round(source.y);
    }
  }

  return normalized;
}
