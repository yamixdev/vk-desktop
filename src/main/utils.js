import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { app } from 'electron';

// Эмуляция __dirname и __filename для ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Резолвит путь относительно текущего файла (utils.js)
 * Используется для внутренних импортов (preload и т.д.)
 */
export const resolvePath = (...args) => join(__dirname, ...args);

/**
 * Возвращает корневой путь приложения.
 * В Dev: папка проекта.
 * В Prod: путь к app.asar
 */
export const getRootPath = () => {
    return app.getAppPath();
};

/**
 * Возвращает путь к распакованным ресурсам.
 * ЭТО САМАЯ ВАЖНАЯ ФУНКЦИЯ ДЛЯ РАСШИРЕНИЙ.
 */
export const getUnpackedPath = () => {
  // Проверяем, упаковано ли приложение (Production билд)
  if (app.isPackaged) {
    // В Electron process.resourcesPath ВСЕГДА указывает на папку resources.
    // electron-builder всегда распаковывает файлы в папку "app.asar.unpacked" внутри resources.
    // Это самый надежный способ получить путь.
    return join(process.resourcesPath, 'app.asar.unpacked');
  }

  // В режиме разработки (Dev) возвращаем просто корень проекта
  return app.getAppPath();
};