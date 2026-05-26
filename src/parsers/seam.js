import { PDF_TUNING } from '../config/pdf.js';

const DEG_GLYPHS = '°º˚';
const DEG_CLASS = `[${DEG_GLYPHS}]`;

/**
 * Text-pattern seam angle detection. Used as a fallback when spatial detection
 * from PDF.js text-item positions fails to find a match within tolerance.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function findSeamAngle(text) {
  const norm = text.replace(/S\s+E\s+A\s+M/gi, 'SEAM');
  const patterns = [
    new RegExp('(\\d{1,3})\\s*' + DEG_CLASS + '\\s*SEAM', 'i'),
    new RegExp('SEAM\\s*' + DEG_CLASS + '?\\s*(\\d{1,3})', 'i'),
    new RegExp('(\\d{1,3})\\s*DEG(?:REES?)?\\s*SEAM', 'i'),
    new RegExp('SEAM\\s*(\\d{1,3})\\s*DEG', 'i'),
    new RegExp('(\\d{1,3})\\s*' + DEG_CLASS + '\\s*W(?:ELD)?\\s*SEAM', 'i'),
  ];

  for (const pat of patterns) {
    const m = norm.match(pat);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v >= 0 && v <= 359) return v;
    }
  }

  // Proximity fallback: scan a window around "SEAM" and return the number
  // whose character offset is closest to the label (not just the first hit).
  const si = norm.search(/SEAM/i);
  if (si >= 0) {
    const winStart = Math.max(0, si - PDF_TUNING.seamTextWindow);
    const winEnd = si + PDF_TUNING.seamTextWindow;
    const win = norm.substring(winStart, winEnd);
    const seamPosInWin = si - winStart;
    let best = null, bestDist = Infinity;
    for (const n of win.matchAll(/\b(\d{1,3})\b/g)) {
      const v = parseInt(n[1], 10);
      if (v < 0 || v > 359) continue;
      const dist = Math.abs(n.index - seamPosInWin);
      if (dist < bestDist) { best = v; bestDist = dist; }
    }
    if (best !== null) return best;
  }

  return null;
}

/**
 * Spatial seam angle detection. Given PDF.js text items grouped by page,
 * finds the angle number physically closest to a "SEAM" label.
 *
 * @param {Array<Array<{str:string,transform:number[]}>>} pages
 * @param {number} maxDistance  Reject matches farther than this (PDF units).
 * @returns {{angle: number|null}}
 */
export function findSeamAngleSpatial(pages, maxDistance) {
  let bestAngle = null;
  let bestDist = Infinity;

  for (const items of pages) {
    const seamItems = items.filter(t => /^S\s*E\s*A\s*M$/i.test(t.str.trim()));
    if (seamItems.length === 0) continue;

    const angleItems = items
      .map(t => {
        const s = t.str.trim();
        if (!new RegExp(`^\\d{1,3}${DEG_CLASS}?$`).test(s)) return null;
        const v = parseInt(s.replace(new RegExp(DEG_CLASS, 'g'), ''), 10);
        if (isNaN(v) || v < 0 || v > 359) return null;
        return { v, x: t.transform[4], y: t.transform[5] };
      })
      .filter(Boolean);

    for (const seam of seamItems) {
      const sx = seam.transform[4];
      const sy = seam.transform[5];
      for (const a of angleItems) {
        const dist = Math.hypot(a.x - sx, a.y - sy);
        if (dist < bestDist) { bestDist = dist; bestAngle = a.v; }
      }
    }
  }

  if (bestAngle !== null && bestDist < maxDistance) return { angle: bestAngle };
  return { angle: null };
}
