import { net } from 'electron';

/**
 * Определяет оптимальный домен VK (vk.ru или vk.com)
 * Проверяет доступность vk.ru с таймаутом.
 *
 * @description Выполняется в Main Process
 * @returns {Promise<'vk.ru'|'vk.com'>}
 */
export function getOptimalDomain() {
  return new Promise((resolve) => {
    // ИЗМЕНЕНО: флаг для предотвращения double-resolve
    let resolved = false;
    
    const safeResolve = (domain) => {
      if (resolved) return;
      resolved = true;
      resolve(domain);
    };

    try {
      console.log('[Resolver] Checking vk.ru...');
      
      const request = net.request({
        method: 'HEAD',
        url: 'https://vk.ru',
        useSessionCookies: false
      });

      // Любой ответ от сервера = домен жив
      request.on('response', (response) => {
        console.log(`[Resolver] vk.ru is alive (${response.statusCode})`);
        safeResolve('vk.ru');
      });

      // Ошибка сети (DNS, Timeout)
      request.on('error', (error) => {
        console.warn('[Resolver] vk.ru unreachable:', error.message);
        safeResolve('vk.com');
      });

      // ИЗМЕНЕНО: обработка abort как ошибки
      request.on('abort', () => {
        console.log('[Resolver] Request aborted -> fallback to vk.com');
        safeResolve('vk.com');
      });

      // Жесткий таймаут самого запроса (1.5 сек)
      const timeoutId = setTimeout(() => {
        if (!resolved && !request.destroyed) {
          request.abort();
          // Не вызываем resolve здесь - это сделает обработчик 'abort'
        }
      }, 1500);

      // ИЗМЕНЕНО: очищаем таймер при успешном resolve
      const originalResolve = safeResolve;
      const wrappedResolve = (domain) => {
        clearTimeout(timeoutId);
        originalResolve(domain);
      };

      // Переопределяем safeResolve для очистки таймера
      request.on('response', () => clearTimeout(timeoutId));
      request.on('error', () => clearTimeout(timeoutId));

      request.end();
      
    } catch (e) {
      console.error('[Resolver] Net error:', e);
      safeResolve('vk.com');
    }
  });
}