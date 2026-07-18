const progressBar = document.querySelector('.bar');
const fill = document.querySelector('#fill');
const percentLabel = document.querySelector('#percent');
const speedLabel = document.querySelector('#speed');
const cancelButton = document.querySelector('#cancel');

window.updateProgress.onProgress(({ percent, speed }) => {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  fill.style.width = `${safePercent}%`;
  percentLabel.textContent = `${Math.round(safePercent)}%`;
  speedLabel.textContent = typeof speed === 'string' ? speed : '—';
  progressBar.setAttribute('aria-valuenow', String(Math.round(safePercent)));
});

cancelButton.addEventListener('click', () => {
  cancelButton.disabled = true;
  window.updateProgress.cancel();
});
