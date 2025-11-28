import fs from 'fs/promises';
import path from 'path';
import { getRootPath } from '../utils.js';

// Агрессивный список трекеров и рекламы, безопасный для аудио
const BLOCK_PATTERNS = [
  // Рекламные сети
  '*.doubleclick.net/*',
  '*.googleadservices.com/*',
  '*.googlesyndication.com/*',
  '*.moatads.com/*',
  
  // VK / Mail.ru специфичные трекеры (тормозят загрузку)
  '*.mail.ru/counter/*',
  '*top-fwz1.mail.ru/*',
  '*tns-counter.ru/*',
  '*counter.yadro.ru/*',
  '*.rbc.ru/*',
  '*.vk.com/ads_rotate.php*',
  '*.vk.com/rtrg*',
  
  // Яндекс метрика (тяжелая)
  '*.an.yandex.ru/*',
  '*.mc.yandex.ru/*',
  '*.yandex.ru/ads/*',
  
  // Прочее
  '*.gemius.pl/*',
  '*.scorecardresearch.com/*'
];

export async function setupAdBlock(session) {
  if (!session) return;

  // Формируем единый Regex для максимальной производительности
  // Экранируем спецсимволы и заменяем звездочки на .*
  const regexStr = BLOCK_PATTERNS
    .map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'))
    .join('|');
    
  const regex = new RegExp(`^https?://(${regexStr})`, 'i');

  session.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      // Блокируем на уровне сети - это экономит трафик и CPU
      if (regex.test(details.url)) {
        // console.log(`[AdBlock] Blocked: ${details.url}`); // Debug
        callback({ cancel: true });
      } else {
        callback({ cancel: false });
      }
    }
  );
  
  console.log('[Security] Network AdBlocker active.');
}