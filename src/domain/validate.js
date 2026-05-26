import { TOLERANCES } from '../config/nozzles.js';
import { printToRTP, angularDist } from './angles.js';

/**
 * @typedef {Object} NozzleResult
 * @property {{name:string,baseDeg:number,label:string}} nozzle
 * @property {number} expectedRTP
 * @property {import('../parsers/cnc.js').CNCFeature|null} bestCut
 * @property {number|null} bestDelta
 * @property {'pass'|'warn'|'fail'} status
 */

/**
 * Greedy one-to-one assignment: repeatedly pick the smallest (nozzle, cut)
 * angular distance and bind them. Each cut can only be claimed once, so a
 * single correct cut cannot mask multiple wrong nozzles.
 *
 * Exception: when two or more nozzles share the same print angle (within
 * tolerance), they are allowed to share a cut — that's a legitimate design
 * pattern, not a masking failure.
 *
 * @param {{name:string,baseDeg:number}[]} nozzles
 * @param {number[]} expectedRTPs
 * @param {import('../parsers/cnc.js').CNCFeature[]} cuts
 */
function assignCuts(nozzles, expectedRTPs, cuts) {
  /** @type {Array<{cut:import('../parsers/cnc.js').CNCFeature|null, delta:number|null}>} */
  const assignments = nozzles.map(() => ({ cut: null, delta: null }));
  const usedCuts = new Set();

  // All (nozzle, cut) pairs sorted by angular distance.
  const pairs = [];
  for (let i = 0; i < nozzles.length; i++) {
    for (let j = 0; j < cuts.length; j++) {
      pairs.push({ i, j, d: angularDist(cuts[j].deg, expectedRTPs[i]) });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  for (const p of pairs) {
    if (assignments[p.i].cut !== null) continue; // nozzle already bound
    if (usedCuts.has(p.j)) {
      // Allow sharing only when another nozzle at the same print angle
      // already claimed this cut.
      const otherIdx = assignments.findIndex(a => a.cut === cuts[p.j]);
      if (otherIdx >= 0 && nozzles[otherIdx].baseDeg === nozzles[p.i].baseDeg) {
        assignments[p.i] = { cut: cuts[p.j], delta: p.d };
      }
      continue;
    }
    assignments[p.i] = { cut: cuts[p.j], delta: p.d };
    usedCuts.add(p.j);
  }

  return { assignments, usedCuts };
}

/**
 * Pure validation: takes parsed CNC + PDF data plus the user's seam/orientation
 * settings and returns a results object the UI can render. No DOM access.
 *
 * @param {{
 *   cncData: import('../parsers/cnc.js').CNCData,
 *   pdfData: import('../parsers/pdf.js').PDFData,
 *   seamAngle: number,
 *   orientation: 'H'|'V',
 *   seamDetected: boolean,
 * }} input
 */
export function validateRun({ cncData, pdfData, seamAngle, orientation, seamDetected }) {
  // ── Pipe size check ────────────────────────────────────────────────────
  const cncOD = cncData.pipeSize ? Math.round(cncData.pipeSize.od * 10) / 10 : null;
  const printOD = pdfData.od;
  const sizePass = cncOD !== null && printOD !== null
    && Math.abs(cncOD - printOD) <= TOLERANCES.pipeODInches;

  // ── Split features ─────────────────────────────────────────────────────
  const allCuts = cncData.features.filter(f => f.type === 'CUT');
  const scribes = cncData.features.filter(f => f.type === 'SCRIBE');
  const nozzles = pdfData.nozzles;

  // Pipe end cuts: extremes in X when there are more cuts than nozzles.
  let endCuts = [];
  let cuts = allCuts;
  if (nozzles.length > 0 && allCuts.length > nozzles.length) {
    const sorted = [...allCuts].sort((a, b) => a.x - b.x);
    const leftEnd = sorted[0];
    const rightEnd = sorted[sorted.length - 1];
    if (leftEnd !== rightEnd) {
      endCuts = [leftEnd, rightEnd];
      const endSet = new Set(endCuts);
      cuts = allCuts.filter(c => !endSet.has(c));
    }
  }

  // ── Nozzle matching (one-to-one with shared-print-angle exception) ────
  const expectedRTPs = nozzles.map(n => printToRTP(n.baseDeg, seamAngle, orientation));
  const { assignments, usedCuts } = assignCuts(nozzles, expectedRTPs, cuts);

  let anyFail = false;
  const nozzleResults = nozzles.map((nozzle, i) => {
    const { cut, delta } = assignments[i];
    let status = 'fail';
    if (cut !== null) {
      if (delta <= TOLERANCES.nozzleAngleDeg) status = 'pass';
      else if (delta <= TOLERANCES.nozzleWarnDeg) { status = 'warn'; anyFail = true; }
      else { anyFail = true; }
    } else {
      anyFail = true;
    }
    return {
      nozzle,
      expectedRTP: expectedRTPs[i],
      bestCut: cut,
      bestDelta: delta,
      status,
    };
  });

  // Cuts no nozzle claimed — surface so the operator can verify them.
  const unmatchedCuts = cuts.filter((_, j) => !usedCuts.has(j));
  if (nozzles.length > 0 && unmatchedCuts.length > 0) anyFail = true;

  // ── Overall banner ─────────────────────────────────────────────────────
  let banner;
  if (!sizePass) {
    banner = { level: 'fail', text: '⛔ PIPE SIZE MISMATCH — DO NOT RUN PROGRAM' };
  } else if (!cncData.pipeSizeFromHeader) {
    banner = { level: 'warn', text: '⚠️ CNC HEADER MISSING — VERIFY PIPE SIZE MANUALLY' };
  } else if (nozzles.length === 0) {
    banner = { level: 'warn', text: '⚠️ NO NOZZLE SCHEDULE DETECTED — VERIFY ANGLES MANUALLY' };
  } else if (anyFail) {
    banner = { level: 'warn', text: '⚠️ REVIEW REQUIRED — SOME NOZZLE LOCATIONS NEED ATTENTION' };
  } else {
    banner = { level: 'pass', text: '✅ LOOKING GOOD — ALL NOZZLE LOCATIONS CONSISTENT' };
  }

  return {
    sizePass, printOD, cncOD,
    pipeSize: cncData.pipeSize,
    pipeSizeFromHeader: cncData.pipeSizeFromHeader,
    seamAngle, seamDetected, orientation,
    programId: cncData.programId,
    nozzles, cuts, allCuts, endCuts, scribes,
    nozzleResults,
    unmatchedCuts,
    warnings: cncData.warnings,
    banner,
    debugLines: cncData.debugLines,
    pdfRawText: pdfData.rawText,
  };
}
