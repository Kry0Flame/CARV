/**
 * Non-blocking toast notifications. Click to dismiss; auto-dismiss after timeout.
 * Replaces alert() — better UX, supports stacking, doesn't block the page.
 */
let container;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/**
 * @param {string} message
 * @param {'info'|'warn'|'error'} [level]
 * @param {number} [timeout]   ms; 0 = sticky
 */
export function toast(message, level = 'info', timeout = 5000) {
  const el = document.createElement('div');
  el.className = `toast toast-${level}`;
  el.textContent = message;
  el.addEventListener('click', () => el.remove());
  ensureContainer().appendChild(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}
