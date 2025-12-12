import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

/**
 * Схема валидации конфигурации с Zod
 * @description Все поля имеют значения по умолчанию
 */
const ConfigSchema = z.object({
  profile: z.enum(['balanced', 'performance', 'powersave']).default('balanced'),
  domain: z.string().default('vk.ru'),
  minimizeToTray: z.boolean().default(true),
  enableDiscord: z.boolean().default(false),
  // VK Next расширение (включает блокировку рекламы)
  enableVKNext: z.boolean().default(true),
  windowState: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    isMaximized: z.boolean().optional()
  }).optional().default({})
});

const DEFAULT_CONFIG = ConfigSchema.parse({});

/**
 * Менеджер конфигурации приложения
 * Обеспечивает загрузку, сохранение и обновление настроек с debounce.
 *
 * @description Выполняется в Main Process
 * @extends EventEmitter
 */
export default class ConfigManager extends EventEmitter {
  /**
   * @param {string} userDataPath - Путь к директории userData приложения
   */
  constructor(userDataPath) {
    super();
    /** @type {string} Путь к файлу конфигурации */
    this.path = path.join(userDataPath, 'config.json');
    /** @type {Object} Текущая конфигурация */
    this.data = { ...DEFAULT_CONFIG };
    /** @type {NodeJS.Timeout|null} Таймер отложенного сохранения */
    this.saveTimer = null;
    /** @type {boolean} Флаг блокировки записи */
    this.isWriting = false;
    /** @type {boolean} Флаг уничтожения менеджера */
    this.isDestroyed = false;
  }

  async load() {
    try {
      // Проверяем, существует ли файл
      await fs.access(this.path);
      const fileContent = await fs.readFile(this.path, 'utf8');
      const parsed = JSON.parse(fileContent);
      // Объединяем с дефолтным конфигом (чтобы не терять новые поля)
      this.data = ConfigSchema.parse({ ...DEFAULT_CONFIG, ...parsed });
    } catch (error) {
      // Если файла нет или он битый - создаем новый
      console.warn('[Config] Файл не найден или поврежден, создаем новый.');
      this.data = { ...DEFAULT_CONFIG };
      await this.save(this.data, true); // Принудительное сохранение
    }
    return this.data;
  }

  get() {
    return this.data;
  }

  // Метод для частичного обновления (patch)
  async update(patch) {
    this.data = { ...this.data, ...patch };
    this.emit('updated', this.data); // Уведомляем интерфейс мгновенно
    await this.save(this.data);
    return this.data;
  }

  async save(data, force = false) {
    // ИЗМЕНЕНО: проверка на уничтоженный менеджер
    if (this.isDestroyed) {
      console.warn('[Config] Cannot save: manager is destroyed');
      return;
    }

    // Обновляем локальные данные сразу
    this.data = { ...this.data, ...data };

    // Если таймер уже запущен - сбрасываем его (Debounce)
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // Функция записи на диск
    const writeToDisk = async () => {
      if (this.isWriting || this.isDestroyed) return;
      this.isWriting = true;

      try {
        const tempPath = `${this.path}.tmp`;
        // 1. Пишем во временный файл
        await fs.writeFile(tempPath, JSON.stringify(this.data, null, 2));
        // 2. Переименовываем (атомарная операция)
        await fs.rename(tempPath, this.path);
      } catch (error) {
        console.error('[Config] Save Error:', error.message);
      } finally {
        this.isWriting = false;
      }
    };

    if (force) {
      await writeToDisk();
    } else {
      // Ждем 1 секунду тишины перед записью, чтобы не насиловать диск при ресайзе окна
      this.saveTimer = setTimeout(writeToDisk, 1000);
    }
  }

  /**
   * ИЗМЕНЕНО: Уничтожает менеджер и освобождает ресурсы
   * Вызывается при выходе из приложения
   * @returns {Promise<void>}
   */
  async destroy() {
    this.isDestroyed = true;

    // Очищаем таймер
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // Ждем завершения записи, если она идет
    if (this.isWriting) {
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.isWriting) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
        
        // Таймаут на случай зависания
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 2000);
      });
    }

    // Удаляем все слушатели
    this.removeAllListeners();
    
    console.log('[Config] Manager destroyed');
  }

  /**
   * Сбрасывает конфигурацию к значениям по умолчанию
   * @returns {Promise<Object>}
   */
  async reset() {
    this.data = { ...DEFAULT_CONFIG };
    await this.save(this.data, true);
    this.emit('updated', this.data);
    return this.data;
  }
}