export const APP_CONFIG = Object.freeze({
  NAME: 'VK Desktop',
  ID: 'com.yamixdev.vkdesktop',
  AUTHOR: 'yamixdev',
  HOMEPAGE: 'https://github.com/yamixdev/vk-desktop',
  MIN_ELECTRON_VERSION: '43.1.1'
});

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/150.0.0.0 Safari/537.36';

export function isDevelopment() {
  return process.env.NODE_ENV === 'development'
    || process.env.DEBUG === 'true'
    || process.argv.includes('--dev')
    || (typeof process.resourcesPath === 'string' && process.resourcesPath.includes('node_modules'));
}

export function getEnvironment() {
  return isDevelopment() ? 'development' : 'production';
}
