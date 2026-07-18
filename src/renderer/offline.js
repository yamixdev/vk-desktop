const ALLOWED_HOSTS = new Set(['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru']);

function getRetryTarget() {
  const rawTarget = new URLSearchParams(window.location.search).get('target');
  if (!rawTarget) return 'https://vk.ru';

  try {
    const target = new URL(rawTarget);
    if (target.protocol === 'https:' && ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
      return target.href;
    }
  } catch {
    // Fall through to the safe default.
  }

  return 'https://vk.ru';
}

function retry() {
  window.location.assign(getRetryTarget());
}

document.querySelector('#retry').addEventListener('click', retry);
window.addEventListener('online', retry, { once: true });
