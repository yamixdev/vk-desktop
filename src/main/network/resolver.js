import { net } from 'electron';

export function getOptimalDomain() {
  return new Promise((resolve) => {
    // Если интернета нет, net.request может упасть. Оборачиваем в try.
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
          resolve('vk.ru');
        });

        // Ошибка сети (DNS, Timeout)
        request.on('error', (error) => {
          console.warn('[Resolver] vk.ru unreachable:', error.message);
          resolve('vk.com');
        });

        // Жесткий таймаут самого запроса (1.5 сек)
        setTimeout(() => {
            if (!request.destroyed) {
                request.abort();
                console.log('[Resolver] Timeout -> fallback to vk.com');
                resolve('vk.com');
            }
        }, 1500);

        request.end();
    } catch (e) {
        console.error('[Resolver] Net error:', e);
        resolve('vk.com'); // В любой непонятной ситуации возвращаем vk.com
    }
  });
}