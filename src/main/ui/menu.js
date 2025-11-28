import { Menu, shell, app, dialog } from 'electron';
import { manualCheck } from '../updater.js'; // Импорт проверки обновлений

export function createApplicationMenu(mainWindow, configManager) {
  const config = configManager.get();

  const template = [
    // 1. ФАЙЛ И НАСТРОЙКИ
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Настройки',
          submenu: [
            {
              label: 'Статус Discord (RPC)',
              type: 'checkbox',
              checked: !!config.enableDiscord,
              click: async () => {
                const newValue = !config.enableDiscord;
                if (newValue) {
                  const { response } = await dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: 'Требуется Discord',
                    message: 'Функция транслирует музыку в статус Discord.',
                    detail: 'Если Discord не запущен, статус работать не будет. Включить?',
                    buttons: ['Включить', 'Отмена'],
                    cancelId: 1
                  });
                  if (response === 1) {
                    createApplicationMenu(mainWindow, configManager); // Возвращаем галочку назад
                    return;
                  }
                }
                configManager.update({ enableDiscord: newValue });
              }
            },
            { type: 'separator' },
            {
              label: 'Сворачивать в трей при закрытии',
              type: 'checkbox',
              checked: config.minimizeToTray,
              click: () => configManager.update({ minimizeToTray: !config.minimizeToTray })
            },
            {
              label: 'Блокировка рекламы (нужен перезапуск)',
              type: 'checkbox',
              checked: config.enableAdBlock,
              click: () => configManager.update({ enableAdBlock: !config.enableAdBlock })
            },
            { type: 'separator' },
            {
              label: 'Режим производительности',
              submenu: [
                {
                  label: 'Сбалансированный',
                  type: 'radio',
                  checked: config.profile === 'balanced',
                  click: () => configManager.update({ profile: 'balanced' })
                },
                {
                  label: 'Максимальная скорость',
                  type: 'radio',
                  checked: config.profile === 'performance',
                  click: () => configManager.update({ profile: 'performance' })
                },
                {
                  label: 'Экономия энергии',
                  type: 'radio',
                  checked: config.profile === 'powersave',
                  click: () => configManager.update({ profile: 'powersave' })
                }
              ]
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Выход',
          accelerator: 'Alt+F4',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]
    },

    // 2. ПРАВКА (Важно для Ctrl+C / Ctrl+V)
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', role: 'undo' },
        { label: 'Вернуть', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' }
      ]
    },

    // 3. НАВИГАЦИЯ
    {
      label: 'Навигация',
      submenu: [
        {
          label: 'Назад',
          accelerator: 'Alt+Left',
          click: () => mainWindow.webContents.canGoBack() && mainWindow.webContents.goBack()
        },
        {
          label: 'Вперёд',
          accelerator: 'Alt+Right',
          click: () => mainWindow.webContents.canGoForward() && mainWindow.webContents.goForward()
        },
        { type: 'separator' },
        {
          label: 'Перезагрузить страницу',
          accelerator: 'F5', // Или Ctrl+R
          click: () => mainWindow.webContents.reload()
        },
        {
          label: 'Принудительная перезагрузка',
          accelerator: 'Ctrl+F5',
          click: () => mainWindow.webContents.reloadIgnoringCache()
        },
        { type: 'separator' },
        {
          label: 'На главную (Лента)',
          accelerator: 'Ctrl+H',
          click: () => mainWindow.loadURL(`https://${config.domain}`)
        }
      ]
    },

    // 4. ВИД
    {
      label: 'Вид',
      submenu: [
        { label: 'Увеличить масштаб', role: 'zoomIn' },
        { label: 'Уменьшить масштаб', role: 'zoomOut' },
        { label: 'Сбросить масштаб', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'На весь экран', role: 'togglefullscreen' }
      ]
    },

    // 5. ПОМОЩЬ
    {
      label: 'Помощь',
      submenu: [
        {
          label: 'Проверить обновления...',
          click: () => manualCheck(mainWindow) // Вызываем функцию из updater.js
        },
        {
          label: 'Открыть GitHub',
          click: () => shell.openExternal('https://github.com/YamixDev/vk-desktop')
        },
        { type: 'separator' },
        {
          label: 'О программе',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'О программе',
              message: 'VK Desktop Wrapper',
              detail: `Версия: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\n\nРазработано с ❤️ и для скорости.`,
              buttons: ['OK'],
              icon: null 
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}