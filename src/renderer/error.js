const ALLOWED_HOSTS = new Set(['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru']);

function getTarget() {
  const rawTarget = new URLSearchParams(window.location.search).get('target');
  try {
    const target = new URL(rawTarget || 'https://vk.ru');
    if (target.protocol === 'https:' && ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
      return target.href;
    }
  } catch {
    // Use the safe default below.
  }
  return 'https://vk.ru';
}

document.querySelector('#retry').addEventListener('click', () => window.location.assign(getTarget()));
