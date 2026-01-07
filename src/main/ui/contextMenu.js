import { Menu, shell, clipboard } from 'electron';

export function setupContextMenu(mainWindow) {
    mainWindow.webContents.on('context-menu', (event, params) => {
        const menuTemplate = [];

        // 1. ОРФОГРАФИЯ (Проверка правописания)
        if (params.misspelledWord && params.misspelledWord.length > 0) {
            if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
                params.dictionarySuggestions.forEach(suggestion => {
                    menuTemplate.push({
                        label: suggestion,
                        click: () => mainWindow.webContents.replaceMisspelling(suggestion)
                    });
                });
            } else {
                menuTemplate.push({ label: 'Нет вариантов', enabled: false });
            }
            
            menuTemplate.push({ type: 'separator' });
            menuTemplate.push({
                label: 'Добавить в словарь',
                click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            });
            menuTemplate.push({ type: 'separator' });
        }

        // 2. ССЫЛКИ
        if (params.linkURL) {
            menuTemplate.push({
                label: 'Открыть ссылку в браузере',
                click: () => shell.openExternal(params.linkURL)
            });
            menuTemplate.push({
                label: 'Копировать адрес ссылки',
                click: () => clipboard.writeText(params.linkURL)
            });
            menuTemplate.push({ type: 'separator' });
        }

        // 3. ИЗОБРАЖЕНИЯ
        if (params.mediaType === 'image' && params.srcURL) {
            menuTemplate.push({
                label: 'Открыть изображение',
                click: () => shell.openExternal(params.srcURL)
            });
            menuTemplate.push({
                label: 'Копировать URL изображения',
                click: () => clipboard.writeText(params.srcURL)
            });
            menuTemplate.push({
                label: 'Сохранить как...',
                click: () => mainWindow.webContents.downloadURL(params.srcURL)
            });
            menuTemplate.push({ type: 'separator' });
        }

        // 4. ВЫДЕЛЕННЫЙ ТЕКСТ
        if (params.selectionText) {
            const text = params.selectionText.trim();
            menuTemplate.push({ label: 'Копировать', role: 'copy' });
            
            if (params.isEditable) {
                menuTemplate.push({ label: 'Вырезать', role: 'cut' });
            }
            
            menuTemplate.push({ type: 'separator' });
            
            const shortText = text.length > 15 ? text.substring(0, 15) + '...' : text;
            
            menuTemplate.push({ 
                label: `Найти в Yandex: "${shortText}"`,
                click: () => shell.openExternal(`https://yandex.ru/search/?text=${encodeURIComponent(text)}`)
            });
            menuTemplate.push({ 
                label: `Найти в Google: "${shortText}"`,
                click: () => shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(text)}`)
            });
            menuTemplate.push({ type: 'separator' });
        }

        // 5. РЕДАКТИРОВАНИЕ (если поле ввода)
        if (params.isEditable) {
            menuTemplate.push({ label: 'Вставить', role: 'paste' });
            menuTemplate.push({ label: 'Выделить всё', role: 'selectAll' });
            menuTemplate.push({ type: 'separator' });
        }

        // 6. НАВИГАЦИЯ И ОБЩЕЕ
        // Показываем, если не выбрана ссылка или картинка, чтобы не засорять меню
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
            menuTemplate.push({
                label: 'Перезагрузить',
                click: () => mainWindow.webContents.reload()
            });
            menuTemplate.push({
                label: 'Копировать адрес страницы',
                click: () => clipboard.writeText(mainWindow.webContents.getURL())
            });
        }

        // 7. ИНСТРУМЕНТЫ РАЗРАБОТЧИКА
        // Добавляем разделитель, если меню не пустое
        if (menuTemplate.length > 0) menuTemplate.push({ type: 'separator' });

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