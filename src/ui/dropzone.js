import { toast } from './toast.js';

/**
 * Wire a drag-and-drop file zone. The invisible <input type="file"> covers the
 * zone, so drag events land on it (not the zone div). We attach listeners to
 * both so drop works regardless of which target the browser reports.
 *
 * @param {string} zoneId
 * @param {string} inputId
 * @param {string} nameId
 * @param {string[]} acceptedExts  e.g. ['.pdf'] or ['.cnc', '.txt']
 * @param {(file: File) => void} onFile
 */
export function wireDrop(zoneId, inputId, nameId, acceptedExts, onFile) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const name = document.getElementById(nameId);
  const exts = acceptedExts.map(e => e.toLowerCase());

  function accept(file) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!exts.some(e => lower.endsWith(e))) {
      toast(`Unsupported file type. Expected: ${exts.join(', ')}`, 'error');
      return;
    }
    zone.classList.add('loaded');
    name.textContent = '✓ ' + file.name;
    onFile(file);
  }

  input.addEventListener('change', () => accept(input.files[0]));

  [zone, input].forEach(el => {
    el.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    el.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      accept(e.dataTransfer.files[0]);
    });
  });
}
