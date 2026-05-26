/**
 * Lightweight structured logger. Keeps a rolling in-memory buffer; the user
 * can grab recent events from devtools via window.__CARV_LOG__.history() or
 * download them as JSON for incident review.
 */
const buffer = [];
const MAX_ENTRIES = 500;

function record(level, event, data) {
  const entry = { t: new Date().toISOString(), level, event, data };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  const fn = console[level] || console.log;
  fn(`[${level}] ${event}`, data ?? '');
  return entry;
}

function download() {
  const blob = new Blob([JSON.stringify(buffer, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `carv-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const logger = {
  info:  (event, data) => record('info',  event, data),
  warn:  (event, data) => record('warn',  event, data),
  error: (event, data) => record('error', event, data),
  history: () => buffer.slice(),
  clear: () => { buffer.length = 0; },
  download,
};
