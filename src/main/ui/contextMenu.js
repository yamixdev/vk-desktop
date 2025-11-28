import { Menu, shell } from 'electron';

export function setupContextMenu(mainWindow) {
    mainWindow.webContents.on('context-menu', (event, params) => {
        const menuTemplate = [];

        // 1. ССЫЛКИ
        if (params.linkURL) {
            menuTemplate.push({
                label: 'Открыть ссылку в браузере',
                click: () => shell.openExternal(params.linkURL)
            });
            menuTemplate.push({
                label: 'Копировать ссылку',
                role: 'copyLink'
            });
            menuTemplate.push({ type: 'separator' });
        }

        // 2. КАРТИНКИ
        if (params.mediaType === 'image') {
            menuTemplate.push({
                label: 'Сохранить изображение как...',
                click: () => mainWindow.webContents.downloadURL(params.srcURL)
            });
            menuTemplate.push({
                label: 'Копировать изображение',
                role: 'copyImage'
            });
            menuTemplate.push({ 
                label: 'Открыть изображение в браузере',
                click: () => shell.openExternal(params.srcURL)
            });
            menuTemplate.push({ type: 'separator' });
        }

        // 3. ТЕКСТ (Выделенный)
        if (params.selectionText) {
            menuTemplate.push({ label: 'Копировать', role: 'copy' });
            menuTemplate.push({ label: 'Вырезать', role: 'cut' });
            menuTemplate.push({ type: 'separator' });
            menuTemplate.push({ 
                label: `Поиск в Google: "${params.selectionText.substring(0, 20)}..."`,
                click: () => shell.openExternal(`https://google.com/search?q=${encodeURIComponent(params.selectionText)}`)
            });
        }

        // 4. ПОЛЯ ВВОДА
        if (params.isEditable) {
            menuTemplate.push({ label: 'Вставить', role: 'paste' });
            menuTemplate.push({ label: 'Выделить всё', role: 'selectAll' });
        }

        // Если меню не пустое — показываем
        if (menuTemplate.length > 0) {
            const menu = Menu.buildFromTemplate(menuTemplate);
            menu.popup({ window: mainWindow });
        }
    });
}