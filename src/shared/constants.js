export const TRUSTED_DOMAINS = [
  'vk.com',
  'vk.ru',
  'm.vk.com',
  'm.vk.ru',
  'vk.me',
  'id.vk.com',
  'login.vk.com',
  'oauth.vk.com'
];

export const IPC_CHANNELS = {
  CONFIG_GET: 'config:get',
  CONFIG_UPDATE: 'config:update',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close'
};

// ОБНОВЛЕНО: Chrome 131.0.0.0 (Решает проблему "Сессия истекла" при входе по QR)
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';