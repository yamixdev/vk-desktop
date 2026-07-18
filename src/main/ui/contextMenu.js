import { app, clipboard, Menu } from 'electron';
import { normalizeExternalUrl } from '../../shared/urlPolicy.js';

export function setupContextMenu(mainWindow, { openExternalUrl }) {
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuTemplate = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions ?? []) {
        menuTemplate.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion)
        });
      }
      if (!params.dictionarySuggestions?.length) {
        menuTemplate.push({ label: 'Нет вариантов', enabled: false });
      }
      menuTemplate.push({
        label: 'Добавить в словарь',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      menuTemplate.push({ type: 'separator' });
    }

    if (params.linkURL) {
      menuTemplate.push({
        label: 'Открыть ссылку в браузере',
        enabled: Boolean(normalizeExternalUrl(params.linkURL)),
        click: () => void openExternalUrl(params.linkURL)
      });
      menuTemplate.push({
        label: 'Копировать адрес ссылки',
        click: () => clipboard.writeText(params.linkURL.slice(0, 4096))
      });
      menuTemplate.push({ type: 'separator' });
    }

    if (params.mediaType === 'image' && params.srcURL) {
      const normalizedImageUrl = normalizeExternalUrl(params.srcURL);
      const isHttpsImage = normalizedImageUrl?.startsWith('https://');
      menuTemplate.push({
        label: 'Открыть изображение',
        enabled: isHttpsImage,
        click: () => void openExternalUrl(params.srcURL)
      });
      menuTemplate.push({
        label: 'Копировать URL изображения',
        click: () => clipboard.writeText(params.srcURL.slice(0, 4096))
      });
      menuTemplate.push({
        label: 'Сохранить как…',
        enabled: isHttpsImage,
        click: () => mainWindow.webContents.downloadURL(normalizedImageUrl)
      });
      menuTemplate.push({ type: 'separator' });
    }

    if (params.selectionText) {
      const text = params.selectionText.trim();
      const query = text.slice(0, 500);
      const shortText = text.length > 24 ? `${text.slice(0, 24)}…` : text;
      menuTemplate.push({ label: 'Копировать', role: 'copy' });
      if (params.isEditable) menuTemplate.push({ label: 'Вырезать', role: 'cut' });
      menuTemplate.push({ type: 'separator' });
      menuTemplate.push({
        label: `Найти в Яндексе: «${shortText}»`,
        click: () => void openExternalUrl(`https://yandex.ru/search/?text=${encodeURIComponent(query)}`)
      });
      menuTemplate.push({
        label: `Найти в Google: «${shortText}»`,
        click: () => void openExternalUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`)
      });
      menuTemplate.push({ type: 'separator' });
    }

    if (params.isEditable) {
      menuTemplate.push({ label: 'Вставить', role: 'paste' });
      menuTemplate.push({ label: 'Выделить всё', role: 'selectAll' });
      menuTemplate.push({ type: 'separator' });
    }

    if (!params.linkURL && !params.mediaType) {
      menuTemplate.push({
        label: 'Назад',
        enabled: mainWindow.webContents.navigationHistory.canGoBack(),
        click: () => mainWindow.webContents.navigationHistory.goBack()
      });
      menuTemplate.push({
        label: 'Вперёд',
        enabled: mainWindow.webContents.navigationHistory.canGoForward(),
        click: () => mainWindow.webContents.navigationHistory.goForward()
      });
      menuTemplate.push({ label: 'Перезагрузить', click: () => mainWindow.webContents.reload() });
      menuTemplate.push({
        label: 'Копировать адрес страницы',
        click: () => clipboard.writeText(mainWindow.webContents.getURL().slice(0, 4096))
      });
    }

    if (!app.isPackaged) {
      if (menuTemplate.length > 0) menuTemplate.push({ type: 'separator' });
      menuTemplate.push({
        label: 'Просмотреть код',
        click: () => mainWindow.webContents.inspectElement(params.x, params.y)
      });
    }

    if (menuTemplate.length > 0) {
      Menu.buildFromTemplate(menuTemplate).popup({ window: mainWindow });
    }
  });
}
