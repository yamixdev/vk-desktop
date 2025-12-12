import { Menu, shell, app, dialog } from 'electron';
import { manualCheck } from '../updater.js'; 

export function createApplicationMenu(mainWindow, configManager) {
  const config = configManager.get();

  const template = [
    // 1. ФАЙЛ
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
                    buttons: ['Включить', 'Отмена'],
                    cancelId: 1
                  });
                  if (response === 1) {
                    createApplicationMenu(mainWindow, configManager);
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

    // 2. ПРАВКА
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

    // 3. НАВИГАЦИЯ (ИСПРАВЛЕНО ЗДЕСЬ)
    {
      label: 'Навигация',
      submenu: [
        {
          label: 'Назад',
          accelerator: 'Alt+Left',
          click: () => {
              if (mainWindow.webContents.navigationHistory.canGoBack()) {
                  mainWindow.webContents.navigationHistory.goBack();
              }
          }
        },
        {
          label: 'Вперёд',
          accelerator: 'Alt+Right',
          click: () => {
              if (mainWindow.webContents.navigationHistory.canGoForward()) {
                  mainWindow.webContents.navigationHistory.goForward();
              }
          }
        },
        { type: 'separator' },
        {
          label: 'Перезагрузить страницу',
          accelerator: 'F5', 
          click: () => mainWindow.webContents.reload()
        },
        {
          label: 'Принудительная перезагрузка',
          accelerator: 'Ctrl+F5',
          click: () => mainWindow.webContents.reloadIgnoringCache()
        },
        { type: 'separator' },
        {
          label: 'На главную',
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
          click: () => manualCheck(mainWindow) 
        },
        {
          label: 'Очистить кеш и перезагрузить',
          click: async () => {
              const { response } = await dialog.showMessageBox(mainWindow, {
                  type: 'question',
                  buttons: ['Очистить', 'Отмена'],
                  title: 'Сброс кеша',
                  message: 'Это исправит проблемы с загрузкой картинок и скриптов.',
                  detail: 'Вам придется заново войти в аккаунт VK.'
              });
              
              if (response === 0) {
                  await mainWindow.webContents.session.clearCache();
                  await mainWindow.webContents.session.clearStorageData();
                  mainWindow.reload();
              }
          }
        },
        { type: 'separator' },
        {
          label: 'О программе',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'О программе',
              message: 'VK Desktop',
              detail: `Версия: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode.js: ${process.versions.node}\n\nРазработано с ❤️`,
              buttons: ['OK']
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