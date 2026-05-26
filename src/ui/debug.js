/**
 * Render the CNC parser debug panel and wire up its show/hide toggle.
 */
export function renderDebug(r, circumference) {
  const debugPanel = document.getElementById('debugPanel');
  const endSet = new Set(r.endCuts);
  const allCutsSummary = r.allCuts
    .map(c => `  CUT id=${c.id}: ${c.deg.toFixed(1)}° @ axial X=${c.x.toFixed(2)}"${endSet.has(c) ? ' ← END CUT' : ''}`)
    .join('\n');

  debugPanel.textContent = [
    `Mode: G90 absolute (default)`,
    `Circumference used: ${circumference.toFixed(4)}"`,
    '',
    `Total features found: ${r.allCuts.length + r.scribes.length} (${r.allCuts.length} cuts, ${r.scribes.length} scribes)`,
    `End cuts identified: ${r.endCuts.length}`,
    `Nozzle cuts: ${r.cuts.length}`,
    '',
    '--- All CUT features (in parse order) ---',
    allCutsSummary,
    '',
    '--- Parser trace ---',
    ...r.debugLines,
  ].join('\n');
}

export function wireDebugToggle() {
  const btn = document.getElementById('debugToggleBtn');
  const panel = document.getElementById('debugPanel');
  btn.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    btn.textContent = open ? '▲ Hide' : '▼ Show';
    btn.setAttribute('aria-expanded', String(open));
  });
}
