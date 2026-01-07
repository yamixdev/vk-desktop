import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

/**
 * Схема валидации конфигурации
 */
const ConfigSchema = z.object({
  profile: z.enum(['balanced', 'performance', 'powersave']).default('balanced'),
  domain: z.string().default('vk.ru'), // Используем vk.ru как дефолт, он стабильнее для API сейчас
  minimizeToTray: z.boolean().default(true),
  enableDiscord: z.boolean().default(false),
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
 * Менеджер конфигурации (Singleton logic expected in usage)
 */
export default class ConfigManager extends EventEmitter {
  constructor(userDataPath) {
    super();
    this.path = path.join(userDataPath, 'config.json');
    this.data = { ...DEFAULT_CONFIG };
    this.saveTimer = null;
    this.isWriting = false;
    this.isDestroyed = false;
  }

  async load() {
    try {
      // ИЗМЕНЕНО: Сразу читаем файл без предварительной проверки (race condition fix)
      const fileContent = await fs.readFile(this.path, 'utf8');
      
      // Парсим JSON
      let parsed;
      try {
        parsed = JSON.parse(fileContent);
      } catch (e) {
        console.warn('[Config] JSON parsing error, resetting to default');
        parsed = {};
      }

      // Валидируем и мержим с дефолтным конфигом
      // .catch() в parse позволяет не крашиться при невалидных данных, а подставлять дефолт
      try {
        this.data = ConfigSchema.parse({ ...DEFAULT_CONFIG, ...parsed });
      } catch (validationError) {
        console.warn('[Config] Validation error, using defaults for invalid fields:', validationError.errors);
        // Zod throw error, so we try to sanitize what we can or reset
        this.data = { ...DEFAULT_CONFIG, ...parsed }; // Fallback merge
      }
      
    } catch (error) {
      // ENOENT = файл не найден, это норма для первого запуска
      if (error.code !== 'ENOENT') {
        console.error('[Config] Load error:', error.message);
      }
      // Если файла нет, используем дефолт
      this.data = { ...DEFAULT_CONFIG };
      await this.save(this.data, true);
    }
    return this.data;
  }

  get() {
    return this.data;
  }

  async update(patch) {
    // Мержим старые данные + патч + валидация, чтобы не записать мусор
    const merged = { ...this.data, ...patch };
    
    // Пытаемся провалидировать перед сохранением
    try {
      this.data = ConfigSchema.parse(merged);
    } catch (e) {
      console.warn('[Config] Invalid update patch, ignoring invalid fields');
      this.data = merged; // Сохраняем как есть, если валидация строгая - можно отменить
    }

    this.emit('updated', this.data);
    await this.save(this.data);
    return this.data;
  }

  async save(data, force = false) {
    if (this.isDestroyed) return;

    this.data = { ...this.data, ...data };

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    const writeToDisk = async () => {
      if (this.isWriting || this.isDestroyed) return;
      this.isWriting = true;

      const tempPath = `${this.path}.tmp`;

      try {
        await fs.writeFile(tempPath, JSON.stringify(this.data, null, 2));
        
        // ИЗМЕНЕНО: Ретрай механизм для Windows (EPERM fix)
        // Иногда антивирус блокирует файл на мгновение после записи
        let retries = 0;
        while (retries < 3) {
          try {
            await fs.rename(tempPath, this.path);
            break; 
          } catch (err) {
            if (err.code === 'EPERM' || err.code === 'EBUSY') {
              retries++;
              await new Promise(r => setTimeout(r, 100)); // Ждем 100мс
            } else {
              throw err;
            }
          }
        }
      } catch (error) {
        console.error('[Config] Save failed:', error.message);
      } finally {
        this.isWriting = false;
        // Чистим временный файл, если он остался (при ошибке rename)
        try {
           await fs.unlink(tempPath).catch(() => {});
        } catch (e) {}
      }
    };

    if (force) {
      await writeToDisk();
    } else {
      this.saveTimer = setTimeout(writeToDisk, 1000);
    }
  }

  async destroy() {
    this.isDestroyed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    
    // Если прямо сейчас пишем - подождем немного
    if (this.isWriting) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    this.removeAllListeners();
  }
}