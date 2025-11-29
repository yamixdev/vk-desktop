import { Menu, shell } from 'electron';

export function setupContextMenu(mainWindow) {
    mainWindow.webContents.on('context-menu', (event, params) => {
        const menuTemplate = [];

        // 1. ОРФОГРАФИЯ
        if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
            params.dictionarySuggestions.forEach(suggestion => {
                menuTemplate.push({
                    label: suggestion,
                    click: () => mainWindow.webContents.replaceMisspelling(suggestion)
                });
            });
            menuTemplate.push({ type: 'separator' });
            menuTemplate.push({
                label: 'Добавить в словарь',
                click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            });
            menuTemplate.push({ type: 'separator' });
        }

        // 2. РЕДАКТИРОВАНИЕ
        if (params.isEditable) {
            menuTemplate.push({ label: 'Отменить', role: 'undo' });
            menuTemplate.push({ label: 'Вернуть', role: 'redo' });
            menuTemplate.push({ type: 'separator' });
            menuTemplate.push({ label: 'Вырезать', role: 'cut' });
            menuTemplate.push({ label: 'Копировать', role: 'copy' });
            menuTemplate.push({ label: 'Вставить', role: 'paste' });
            menuTemplate.push({ label: 'Выделить всё', role: 'selectAll' });
        }

        // 3. ВЫДЕЛЕННЫЙ ТЕКСТ
        else if (params.selectionText) {
            menuTemplate.push({ label: 'Копировать', role: 'copy' });
            menuTemplate.push({ type: 'separator' });
            menuTemplate.push({ 
                label: `Найти в Yandex: "${params.selectionText.substring(0, 15)}..."`,
                click: () => shell.openExternal(`https://yandex.ru/search/?text=${encodeURIComponent(params.selectionText)}`)
            });
        }

        // 4. ССЫЛКИ
        else if (params.linkURL) {
            menuTemplate.push({
                label: 'Открыть ссылку в браузере',
                click: () => shell.openExternal(params.linkURL)
            });
            menuTemplate.push({
                label: 'Копировать адрес ссылки',
                role: 'copyLink'
            });
        }

        // 5. КАРТИНКИ
        else if (params.mediaType === 'image') {
            menuTemplate.push({
                label: 'Открыть изображение в браузере',
                click: () => shell.openExternal(params.srcURL)
            });
            menuTemplate.push({
                label: 'Сохранить изображение как...',
                click: () => mainWindow.webContents.downloadURL(params.srcURL)
            });
            menuTemplate.push({
                label: 'Копировать URL изображения',
                role: 'copyImage'
            });
        }

        // 6. ОБЩЕЕ (НАВИГАЦИЯ - ИСПРАВЛЕНО)
        else {
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
            menuTemplate.push({
                label: 'Перезагрузить',
                click: () => mainWindow.webContents.reload()
            });
        }
        
        // Разделитель
        if (menuTemplate.length > 0) menuTemplate.push({ type: 'separator' });

        // 7. КОД (Оставил на всякий случай, если удалишь - не страшно)
        menuTemplate.push({
            label: 'Просмотреть код',
            click: () => mainWindow.webContents.inspectElement(params.x, params.y)
        });

        if (menuTemplate.length > 0) {
            const menu = Menu.buildFromTemplate(menuTemplate);
            menu.popup({ window: mainWindow });
        }
    });
}