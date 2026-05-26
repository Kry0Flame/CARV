import { findSeamAngle, findSeamAngleSpatial } from './seam.js';
import { PDF_TUNING } from '../config/pdf.js';

/**
 * @typedef {Object} NozzleDef
 * @property {string} name     e.g. "N1", "N-2", "A"
 * @property {number} baseDeg  print angle (0–359)
 * @property {string} label    description if found, else ''
 */

/**
 * @typedef {Object} PDFData
 * @property {number|null} od
 * @property {number|null} seamAngle
 * @property {string} seamMethod
 * @property {NozzleDef[]} nozzles
 * @property {string} rawText
 */

/**
 * Open a PDF once and return the page items + concatenated text. Result is
 * cached on the File object so a subsequent call is a no-op.
 *
 * @param {File} file
 * @returns {Promise<{items: Array<Array<object>>, fullText: string}>}
 */
async function loadPDF(file) {
  if (file.__carvCache) return file.__carvCache;
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

  const items = [];
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    items.push(tc.items);
    fullText += tc.items.map(t => t.str).join(' ') + '\n';
  }
  file.__carvCache = { items, fullText };
  return file.__carvCache;
}

/**
 * Extract OD, seam angle, nozzle schedule, and full text from a certified
 * drawing PDF. Uses a per-file cache so seam autodetect and full parse don't
 * re-decode the document.
 *
 * @param {File} file
 * @returns {Promise<PDFData>}
 */
export async function parsePDF(file) {
  const { items, fullText } = await loadPDF(file);

  const seam = findSeamAngleSpatial(items, PDF_TUNING.seamMaxDistance);
  const seamAngle = seam.angle !== null ? seam.angle : findSeamAngle(fullText);
  const seamMethod = seam.angle !== null
    ? 'Auto-detected (spatial)'
    : (seamAngle !== null ? 'Auto-detected (text)' : 'Not detected');

  return {
    od: extractOD(fullText),
    seamAngle,
    seamMethod,
    nozzles: extractNozzles(items, fullText),
    rawText: fullText,
  };
}

/**
 * Convenience: just the seam angle. Used on PDF drop to populate the seam
 * input before the user clicks Check. Shares the same per-file cache as
 * parsePDF, so the full document is only decoded once.
 *
 * @param {File} file
 * @returns {Promise<{angle: number|null, method: string}>}
 */
export async function autoDetectSeam(file) {
  const { items, fullText } = await loadPDF(file);
  const spatial = findSeamAngleSpatial(items, PDF_TUNING.seamMaxDistance);
  if (spatial.angle !== null) {
    return { angle: spatial.angle, method: 'Auto-detected (spatial)' };
  }
  const angle = findSeamAngle(fullText);
  return { angle, method: angle !== null ? 'Auto-detected (text)' : 'Not detected' };
}

/**
 * Extract pipe OD. Prefers a labelled "pipe O.D." occurrence, falling back to
 * the largest plausible OD-looking number in the document (small ODs are
 * usually nozzles or fittings).
 *
 * @param {string} text
 * @returns {number|null}
 */
function extractOD(text) {
  // Prefer explicitly labelled pipe / shell OD.
  const labelled = text.match(
    /(?:pipe|shell|vessel)[^\n]{0,40}?(\d+(?:\.\d+)?)\s*["”]?\s*O\.?\s*D\.?/i
  );
  if (labelled) {
    const v = parseFloat(labelled[1]);
    if (v > 0 && v < 200) return v;
  }

  // Fallback: take the largest OD-style number — pipe OD is almost always
  // larger than nozzle ODs on the same drawing.
  const all = [...text.matchAll(/(\d+(?:\.\d+)?)\s*["”]?\s*O\.?\s*D\.?/gi)]
    .map(m => parseFloat(m[1]))
    .filter(v => v > 1 && v < 200);
  if (all.length === 0) return null;
  return Math.max(...all);
}

/**
 * Spatial nozzle schedule extraction using PDF.js text item positions.
 *
 * Strategy:
 *   1. Group text items into rows by Y-position proximity.
 *   2. Find rows containing a nozzle designator (N1, N-1, N1A, etc.).
 *   3. Pair each nozzle to the angle item whose X position is closest to it.
 *      Only angles with an explicit degree glyph are accepted — bare numbers
 *      in the same row are too easy to confuse with pressure classes,
 *      schedule numbers, sizes, etc.
 *   4. Fall back to line-by-line text scan if spatial extraction finds nothing.
 *
 * @param {Array<Array<{str:string,transform:number[]}>>} pages
 * @param {string} fullText
 * @returns {NozzleDef[]}
 */
function extractNozzles(pages, fullText) {
  const nozzles = [];
  const seen = new Set();

  for (const items of pages) {
    // Cluster items into rows by Y proximity.
    const rows = [];
    for (const item of items) {
      const y = item.transform[5];
      const row = rows.find(r => Math.abs(r.y - y) <= PDF_TUNING.rowToleranceY);
      if (row) row.items.push(item);
      else rows.push({ y, items: [item] });
    }

    for (const row of rows) {
      row.items.sort((a, b) => a.transform[4] - b.transform[4]);

      // Items in this row that look like nozzle designators, with x-position.
      const nozzleItems = [];
      for (const it of row.items) {
        const m = it.str.trim().match(/^(N[-]?\d{1,2}[A-Z]?)$/i);
        if (m) nozzleItems.push({ name: m[1], x: it.transform[4] });
      }
      if (nozzleItems.length === 0) continue;

      // Items in this row that look like an angle WITH a degree glyph.
      const angleItems = [];
      for (const it of row.items) {
        const s = it.str.trim();
        const m = s.match(/^(\d{1,3})\s*[°º˚]$/);
        if (!m) continue;
        const v = parseInt(m[1], 10);
        if (v >= 0 && v <= 359) angleItems.push({ deg: v, x: it.transform[4] });
      }

      // Also accept combined "N1 ... 45°" strings as a degraded fallback for
      // PDFs where the degree glyph attaches to a different text item.
      const combinedText = row.items.map(i => i.str.trim()).filter(Boolean).join(' ');
      const combinedAngles = [...combinedText.matchAll(/(\d{1,3})\s*[°º˚]/g)]
        .map(m => parseInt(m[1], 10))
        .filter(n => n >= 0 && n <= 359);

      for (const nz of nozzleItems) {
        const name = nz.name.replace(/[-\s]/g, '').toUpperCase();
        if (seen.has(name)) continue;

        let deg = null;
        if (angleItems.length > 0) {
          // Pair by horizontal proximity — the visually-nearest angle wins.
          let best = angleItems[0], bestDx = Math.abs(angleItems[0].x - nz.x);
          for (const a of angleItems) {
            const dx = Math.abs(a.x - nz.x);
            if (dx < bestDx) { best = a; bestDx = dx; }
          }
          deg = best.deg;
        } else if (combinedAngles.length === 1) {
          deg = combinedAngles[0];
        }
        if (deg === null) continue;

        seen.add(name);
        nozzles.push({ name, baseDeg: deg, label: '' });
      }
    }
  }

  // Text fallback: scan lines for "N1 ... 45°" if spatial found nothing.
  if (nozzles.length === 0) {
    for (const line of fullText.split('\n')) {
      const nm = line.match(/\b(N[-]?\d{1,2}[A-Z]?)\b/i);
      if (!nm) continue;
      const name = nm[1].replace(/[-\s]/g, '').toUpperCase();
      if (seen.has(name)) continue;
      const degM = line.match(/\b(\d{1,3})\s*[°º˚]/);
      if (!degM) continue;
      const deg = parseInt(degM[1], 10);
      if (deg < 0 || deg > 359) continue;
      seen.add(name);
      nozzles.push({ name, baseDeg: deg, label: '' });
    }
  }

  // Natural sort: N1, N2, ..., N10, N11
  return nozzles.sort((a, b) => {
    const na = parseInt(a.name.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.name.replace(/\D/g, ''), 10) || 0;
    return na - nb || a.name.localeCompare(b.name);
  });
}
