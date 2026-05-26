import { DEFAULT_CIRCUMFERENCE } from '../config/nozzles.js';
import { logger } from '../lib/logger.js';

/**
 * @typedef {Object} CNCFeature
 * @property {'CUT'|'SCRIBE'} type
 * @property {number} x   Axial position along pipe length (inches)
 * @property {number} y   Belt position / circumferential (inches)
 * @property {number} deg Circumferential angle (0–360)
 * @property {number} id
 */

/**
 * @typedef {Object} PipeSize
 * @property {number} length
 * @property {number} circumference
 * @property {number} thickness
 * @property {number} od
 */

/**
 * @typedef {Object} CNCData
 * @property {PipeSize|null} pipeSize
 * @property {boolean} pipeSizeFromHeader  False when DEFAULT_CIRCUMFERENCE was used
 * @property {CNCFeature[]} features
 * @property {string} programId
 * @property {string[]} debugLines
 * @property {string[]} warnings           Parser-level warnings surfaced in UI
 */

/**
 * Parse a Rotary Tube Pro CNC program.
 *
 * Axis convention:
 *   Y = belt/rotary position (circumferential). Converted to degrees via circumference.
 *   X = linear position along pipe length (axial).
 *   C-axis command (e.g. C270) = absolute rotation in degrees → sets Y belt position.
 *
 * @param {string} text
 * @returns {CNCData}
 */
export function parseCNC(text) {
  /** @type {CNCData} */
  const result = {
    pipeSize: null,
    pipeSizeFromHeader: false,
    features: [],
    programId: '',
    debugLines: [],
    warnings: [],
  };

  // Permissive header match: tolerate spacing variations / missing trailing quote.
  // Captures: material-name, length, circumference, thickness.
  const hdr = text.match(
    /\(CutPro Wizard\s*-\s*Load Material\s*:\s*(.+?);\s*([\d.]+)"?\s*x\s*([\d.]+)"?\s*;\s*([\d.]+)"?\s*\)/i
  );
  if (hdr) {
    const circumference = parseFloat(hdr[3]);
    if (circumference > 0) {
      result.pipeSize = {
        length: parseFloat(hdr[2]),
        circumference,
        thickness: parseFloat(hdr[4]),
        od: circumference / Math.PI,
      };
      result.pipeSizeFromHeader = true;
    }
  }
  if (!result.pipeSizeFromHeader) {
    result.warnings.push(
      `CNC header not found — using default circumference ${DEFAULT_CIRCUMFERENCE.toFixed(3)}" (20" OD). Angles may be incorrect for other pipe sizes.`
    );
    logger.warn('cnc.headerMissing', { defaultCirc: DEFAULT_CIRCUMFERENCE });
  }

  const seqMatch = text.match(/\(Seq \d+ - (.+?)\)/);
  if (seqMatch) result.programId = seqMatch[1].trim();

  const circ = result.pipeSize ? result.pipeSize.circumference : DEFAULT_CIRCUMFERENCE;

  let x = 0, y = 0;
  let absMode = true; // G90 absolute is the default
  let inFeature = false, fType = null, fStart = null, fStartLineNum = 0;
  let featureCount = 0;

  const applyX = v => { x = absMode ? v : x + v; };
  const applyY = v => { y = absMode ? v : y + v; };

  const rawLines = text.split('\n');
  for (let lineNum = 0; lineNum < rawLines.length; lineNum++) {
    // Strip inline comments before tokenizing: ";..." to EOL and "(...)" parens.
    const stripped = rawLines[lineNum]
      .replace(/\(.*?\)/g, ' ')
      .replace(/;.*$/, '')
      .trim();
    if (!stripped) continue;

    // Tokenize on whitespace so compound blocks like "G90 G01 X5.0" parse correctly.
    const tokens = stripped.split(/\s+/);

    // Process mode words first so they apply to any X/Y on the same line.
    if (tokens.includes('G90')) absMode = true;
    if (tokens.includes('G91')) absMode = false;

    // Whole-line C-axis command (own line — typical for RTP posts).
    const cAxisM = stripped.match(/^C([+-]?[\d.]+)$/);
    if (cAxisM) {
      const cDeg = parseFloat(cAxisM[1]);
      y = (cDeg / 360) * circ;
      result.debugLines.push(`C-axis → ${cDeg.toFixed(1)}° → Y=${y.toFixed(3)}"`);
      continue;
    }

    // G00-G03 motion: extract X and Y from any token on the line.
    const hasMotion = tokens.some(t => /^G0[0123]$/.test(t));
    if (hasMotion) {
      const xm = stripped.match(/\bX([+-]?[\d.]+)/);
      const ym = stripped.match(/\bY([+-]?[\d.]+)/);
      if (xm) applyX(parseFloat(xm[1]));
      if (ym) applyY(parseFloat(ym[1]));
      // No `continue` — a motion line may also contain an M-code in some dialects.
    }

    // Feature start (M07 = CUT, M09 = SCRIBE). Only first start per feature counts.
    const startTok = tokens.find(t => t === 'M07' || t === 'M09');
    if (startTok && !inFeature) {
      inFeature = true;
      fType = startTok === 'M09' ? 'SCRIBE' : 'CUT';
      fStart = { x, y };
      fStartLineNum = lineNum + 1;
      continue;
    }

    // Feature end (M08 / M10 — with or without modifiers like "RT", "RF").
    const endTok = tokens.find(t => t === 'M08' || t === 'M10');
    if (endTok && inFeature) {
      if (fStart) {
        let deg = ((fStart.y / circ) * 360) % 360;
        if (deg < 0) deg += 360;
        featureCount++;
        result.features.push({ type: fType, x: fStart.x, y: fStart.y, deg, id: featureCount });
        result.debugLines.push(
          `${fType} #${featureCount}: Y=${fStart.y.toFixed(3)}" → ${deg.toFixed(1)}°, X=${fStart.x.toFixed(3)}" (axial)`
        );
      }
      inFeature = false; fType = null; fStart = null;
      continue;
    }
  }

  // Unclosed feature — surface as a warning instead of silently dropping.
  if (inFeature) {
    const msg = `Unclosed ${fType} feature started at line ${fStartLineNum} — no matching M08/M10. Feature dropped.`;
    result.warnings.push(msg);
    logger.warn('cnc.unclosedFeature', { type: fType, line: fStartLineNum });
  }

  return result;
}
