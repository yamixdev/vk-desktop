import { dialog, shell } from 'electron';
import {
  classifyNavigationUrl,
  normalizeExternalUrl
} from '../../shared/urlPolicy.js';

export function createExternalUrlOpener(getParentWindow) {
  return async function openExternalUrl(rawUrl) {
    const classification = classifyNavigationUrl(rawUrl);
    const normalizedUrl = normalizeExternalUrl(rawUrl);
    if (!normalizedUrl) {
      console.warn('[Security] Blocked external URL:', String(rawUrl).slice(0, 200));
      return false;
    }

    if (classification === 'external-confirmation') {
      const parentWindow = getParentWindow?.();
      const options = {
        type: 'question',
        title: 'Открыть почтовую программу?',
        message: 'Ссылка хочет открыть внешнее почтовое приложение.',
        detail: normalizedUrl.slice(0, 500),
        buttons: ['Открыть', 'Отмена'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      };
      const { response } = parentWindow && !parentWindow.isDestroyed()
        ? await dialog.showMessageBox(parentWindow, options)
        : await dialog.showMessageBox(options);
      if (response !== 0) return false;
    }

    await shell.openExternal(normalizedUrl, { activate: true });
    return true;
  };
}
