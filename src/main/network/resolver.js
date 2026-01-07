import { net } from 'electron';
/**
 * Определяет оптимальный домен VK
 */
export function getOptimalDomain() {
  return new Promise((resolve) => {
    let resolved = false;
    
    const safeResolve = (domain) => {
      if (resolved) return;
      resolved = true;
      resolve(domain);
    };

    try {
      const request = net.request({
        method: 'HEAD',
        url: 'https://vk.ru',
        useSessionCookies: false
      });

      request.on('response', () => safeResolve('vk.ru'));
      request.on('error', () => safeResolve('vk.com'));
      request.on('abort', () => safeResolve('vk.com'));

      // Таймаут 1.5 сек
      setTimeout(() => {
        if (!resolved) request.abort();
      }, 1500);

      request.end();
    } catch (e) {
      safeResolve('vk.com');
    }
  });
}