import { Menu, app, dialog } from 'electron';
import { manualCheck } from '../updater.js'; 

export function createApplicationMenu(mainWindow, configManager) {
  const config = configManager.get();
  const domain = config.domain || 'vk.com';

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
                // Если включаем, показываем предупреждение
                if (newValue) {
                  const { response } = await dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: 'Discord RPC',
                    message: 'Интеграция с Discord',
                    detail: 'Приложение будет показывать текущий трек в вашем статусе Discord. Требуется запущенный Discord.',
                    buttons: ['Включить', 'Отмена'],
                    cancelId: 1
                  });
                  if (response === 1) return; // Отмена
                }
                
                await configManager.update({ enableDiscord: newValue });
                // Меню перерисуется автоматически через событие 'updated' в main.js
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
              label: 'Профиль производительности',
              submenu: [
                {
                  label: 'Сбалансированный',
                  type: 'radio',
                  checked: config.profile === 'balanced',
                  click: () => configManager.update({ profile: 'balanced' })
                },
                {
                  label: 'Производительность',
                  type: 'radio',
                  checked: config.profile === 'performance',
                  click: () => configManager.update({ profile: 'performance' })
                },
                {
                  label: 'Энергосбережение',
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

    // 3. НАВИГАЦИЯ
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
          label: 'Перезагрузить',
          accelerator: 'F5', 
          click: () => mainWindow.webContents.reload()
        },
        {
          label: 'Полная перезагрузка',
          accelerator: 'Ctrl+F5',
          click: () => mainWindow.webContents.reloadIgnoringCache()
        },
        { type: 'separator' },
        {
          label: 'На главную',
          accelerator: 'Ctrl+H',
          click: () => mainWindow.loadURL(`https://${domain}`)
        },
        {
          label: 'Музыка',
          click: () => mainWindow.loadURL(`https://${domain}/music`)
        },
        {
          label: 'Сообщения',
          click: () => mainWindow.loadURL(`https://${domain}/im`)
        }
      ]
    },

    // 4. ВИД
    {
      label: 'Вид',
      submenu: [
        { label: 'Увеличить', role: 'zoomIn' },
        { label: 'Уменьшить', role: 'zoomOut' },
        { label: 'Сбросить масштаб', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'На весь экран', role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Инструменты разработчика',
          accelerator: 'Ctrl+Shift+I',
          click: () => mainWindow.webContents.toggleDevTools()
        }
      ]
    },

    // 5. ПОМОЩЬ
    {
      label: 'Помощь',
      submenu: [
        {
          label: 'Проверить обновления',
          click: () => manualCheck(mainWindow) 
        },
        {
          label: 'Сбросить кеш',
          click: async () => {
              const { response } = await dialog.showMessageBox(mainWindow, {
                  type: 'warning',
                  buttons: ['Сбросить', 'Отмена'],
                  title: 'Сброс кеша',
                  message: 'Вы уверены?',
                  detail: 'Это исправит проблемы с отображением, но вам придется войти в аккаунт заново.',
                  cancelId: 1
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
              title: 'VK Desktop',
              message: 'VK Desktop',
              detail: `Версия: ${app.getVersion()}\n` +
                      `Electron: ${process.versions.electron}\n` +
                      `Chrome: ${process.versions.chrome}\n` +
                      `Node.js: ${process.versions.node}\n\n` +
                      `Неофициальный клиент с поддержкой Discord RPC.\nСоздано с ❤️`,
              buttons: ['OK'],
              noLink: true
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