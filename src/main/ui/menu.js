import { app, dialog, Menu } from 'electron';
import { manualCheck } from '../updater.js';
import { APP_ROUTES, navigateMainWindow } from '../window/navigation.js';

export function createApplicationMenu(mainWindow, configManager, services = {}) {
  const config = configManager.get();
  const domain = config.domain;

  const showActionError = (error) => {
    console.warn('[Menu] Action failed:', error.message);
    if (mainWindow.isDestroyed()) return;
    void dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'VK Desktop',
      message: 'Не удалось выполнить действие.',
      detail: error.message,
      buttons: ['ОК'],
      noLink: true
    });
  };

  const updateConfig = async (patch) => {
    try {
      await configManager.update(patch);
      return true;
    } catch (error) {
      showActionError(error);
      return false;
    }
  };

  const navigate = (route) => {
    void navigateMainWindow(mainWindow, route, domain).catch(showActionError);
  };

  const settingsSubmenu = [
    {
      label: 'Статус Discord (RPC)',
      type: 'checkbox',
      checked: config.enableDiscord,
      click: async (menuItem) => {
        const enabled = !config.enableDiscord;
        if (enabled) {
          const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Discord RPC',
            message: 'Включить статус текущего трека в Discord?',
            detail: 'Для работы нужен запущенный Discord.',
            buttons: ['Включить', 'Отмена'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
          });
          if (response !== 0) {
            menuItem.checked = config.enableDiscord;
            return;
          }
        }
        if (!await updateConfig({ enableDiscord: enabled })) {
          menuItem.checked = config.enableDiscord;
        }
      }
    },
    {
      label: 'VK Next',
      type: 'checkbox',
      checked: config.enableVKNext,
      click: async (menuItem) => {
        const enabled = !config.enableVKNext;
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: enabled ? 'Включить VK Next?' : 'Отключить VK Next?',
          message: 'Страница VK будет перезагружена.',
          detail: 'Воспроизведение музыки прервётся, а несохранённый текст в полях ввода может потеряться.',
          buttons: [enabled ? 'Включить и перезагрузить' : 'Отключить и перезагрузить', 'Отмена'],
          defaultId: 1,
          cancelId: 1,
          noLink: true
        });
        if (response !== 0) {
          menuItem.checked = config.enableVKNext;
          return;
        }

        try {
          await services.onToggleVKNext?.(enabled);
        } catch (error) {
          menuItem.checked = config.enableVKNext;
          await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'VK Next',
            message: enabled ? 'Не удалось включить VK Next' : 'Не удалось отключить VK Next',
            detail: error.message,
            buttons: ['ОК'],
            noLink: true
          });
        }
      }
    },
    {
      label: 'Открыть настройки VK Next',
      enabled: config.enableVKNext,
      click: () => services.onOpenVKNextSettings?.()
    },
    { type: 'separator' },
    {
      label: 'Сворачивать в трей при закрытии',
      type: 'checkbox',
      checked: config.minimizeToTray,
      click: () => { void updateConfig({ minimizeToTray: !config.minimizeToTray }); }
    },
    { type: 'separator' },
    {
      label: 'Профиль производительности',
      submenu: [
        {
          label: 'Сбалансированный',
          type: 'radio',
          checked: config.profile === 'balanced',
          click: () => { void updateConfig({ profile: 'balanced' }); }
        },
        {
          label: 'Производительность',
          type: 'radio',
          checked: config.profile === 'performance',
          click: () => { void updateConfig({ profile: 'performance' }); }
        },
        {
          label: 'Энергосбережение',
          type: 'radio',
          checked: config.profile === 'powersave',
          click: () => { void updateConfig({ profile: 'powersave' }); }
        }
      ]
    }
  ];

  const viewSubmenu = [
    { label: 'Увеличить', role: 'zoomIn' },
    { label: 'Уменьшить', role: 'zoomOut' },
    { label: 'Сбросить масштаб', role: 'resetZoom' },
    { type: 'separator' },
    { label: 'На весь экран', role: 'togglefullscreen' }
  ];
  if (!app.isPackaged) {
    viewSubmenu.push(
      { type: 'separator' },
      {
        label: 'Инструменты разработчика',
        accelerator: 'Ctrl+Shift+I',
        click: () => mainWindow.webContents.toggleDevTools()
      }
    );
  }

  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Настройки', submenu: settingsSubmenu },
        { type: 'separator' },
        { label: 'Выход', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
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
    {
      label: 'Навигация',
      submenu: [
        {
          label: 'Назад',
          accelerator: 'Alt+Left',
          click: () => mainWindow.webContents.navigationHistory.canGoBack()
            && mainWindow.webContents.navigationHistory.goBack()
        },
        {
          label: 'Вперёд',
          accelerator: 'Alt+Right',
          click: () => mainWindow.webContents.navigationHistory.canGoForward()
            && mainWindow.webContents.navigationHistory.goForward()
        },
        { type: 'separator' },
        { label: 'Перезагрузить', accelerator: 'F5', click: () => mainWindow.webContents.reload() },
        { label: 'Полная перезагрузка', accelerator: 'Ctrl+F5', click: () => mainWindow.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'На главную', accelerator: 'Ctrl+H', click: () => navigate(APP_ROUTES.HOME) },
        { label: 'Музыка', click: () => navigate(APP_ROUTES.MUSIC) },
        { label: 'Сообщения', click: () => navigate(APP_ROUTES.MESSAGES) }
      ]
    },
    { label: 'Вид', submenu: viewSubmenu },
    {
      label: 'Помощь',
      submenu: [
        { label: 'Проверить обновления', click: () => manualCheck(mainWindow) },
        {
          label: 'Сбросить кеш и данные сайта',
          click: async () => {
            const { response } = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Сброс данных',
              message: 'Удалить кеш, cookies и локальные данные VK?',
              detail: 'Потребуется снова войти в аккаунт.',
              buttons: ['Удалить и перезагрузить', 'Отмена'],
              defaultId: 1,
              cancelId: 1,
              noLink: true
            });
            if (response === 0) {
              try {
                await mainWindow.webContents.session.clearCache();
                await mainWindow.webContents.session.clearStorageData();
                mainWindow.reload();
              } catch (error) {
                showActionError(error);
              }
            }
          }
        },
        { type: 'separator' },
        {
          label: 'О программе',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'VK Desktop',
            message: 'VK Desktop',
            detail: [
              `Версия: ${app.getVersion()}`,
              `Electron: ${process.versions.electron}`,
              `Chrome: ${process.versions.chrome}`,
              `Node.js: ${process.versions.node}`,
              '',
              'Неофициальный клиент VK с поддержкой Discord RPC.'
            ].join('\n'),
            buttons: ['ОК'],
            noLink: true
          })
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}
