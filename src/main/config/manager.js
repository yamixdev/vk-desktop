import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

// Схема валидации
const ConfigSchema = z.object({
  profile: z.enum(['balanced', 'performance', 'powersave']).default('balanced'),
  domain: z.string().default('vk.ru'),
  minimizeToTray: z.boolean().default(true),
  enableAdBlock: z.boolean().default(true),
  enableDiscord: z.boolean().default(false), // Добавили поле для Discord
  windowState: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    isMaximized: z.boolean().optional()
  }).optional().default({})
});

const DEFAULT_CONFIG = ConfigSchema.parse({});

export default class ConfigManager extends EventEmitter {
  constructor(userDataPath) {
    super();
    this.path = path.join(userDataPath, 'config.json');
    this.data = { ...DEFAULT_CONFIG };
    this.saveTimer = null;
    this.isWriting = false; // Блокировка записи
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
    // Обновляем локальные данные сразу
    this.data = { ...this.data, ...data };

    // Если таймер уже запущен - сбрасываем его (Debounce)
    if (this.saveTimer) clearTimeout(this.saveTimer);

    // Функция записи на диск
    const writeToDisk = async () => {
      if (this.isWriting) return; // Если уже пишем - выходим, ждем следующего раза
      this.isWriting = true;

      try {
        const tempPath = `${this.path}.tmp`;
        // 1. Пишем во временный файл
        await fs.writeFile(tempPath, JSON.stringify(this.data, null, 2));
        // 2. Переименовываем (атомарная операция)
        await fs.rename(tempPath, this.path);
        // console.log('[Config] Saved.'); // Можно раскомментировать для отладки
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
}