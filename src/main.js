/**
 * CARV bootstrap. Wires DOM events to the pure parsing / validation pipeline.
 *
 * Architecture:
 *   parsers/  — pure functions, no DOM, take strings/files, return data
 *   domain/   — pure validation + angle math
 *   ui/       — DOM rendering only, no business logic
 *   state.js  — central store, single source of truth
 *   main.js   — wires everything together
 */
import { state, setState } from './state.js';
import { wireDrop } from './ui/dropzone.js';
import { toast } from './ui/toast.js';
import { renderResults } from './ui/results.js';
import { renderDebug, wireDebugToggle } from './ui/debug.js';
import { parseCNC } from './parsers/cnc.js';
import { parsePDF, autoDetectSeam } from './parsers/pdf.js';
import { validateRun } from './domain/validate.js';
import { DEFAULT_CIRCUMFERENCE } from './config/nozzles.js';
import { logger } from './lib/logger.js';

// PDF.js worker (loaded as a global via CDN script tag in index.html)
window.pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const seamInput = document.getElementById('seamAngle');
const checkBtn  = document.getElementById('btnCheck');

function updateBtn() {
  if (state.pdfFile && state.cncFile) {
    checkBtn.disabled = false;
    checkBtn.textContent = 'CHECK MY WORK';
  } else {
    checkBtn.disabled = true;
    checkBtn.textContent = 'DROP BOTH FILES TO CHECK';
  }
}

function setOrientation(v) {
  setState({ orientation: v });
  document.getElementById('togHoriz').classList.toggle('active', v === 'H');
  document.getElementById('togVert').classList.toggle('active', v === 'V');
  document.getElementById('togHoriz').setAttribute('aria-pressed', String(v === 'H'));
  document.getElementById('togVert').setAttribute('aria-pressed', String(v === 'V'));
  logger.info('orientation.set', { orientation: v });
}

function clearSeamUI() {
  seamInput.value = '';
  seamInput.style.borderColor = '';
  seamInput.title = '';
}

// ── Wire UI events ───────────────────────────────────────────────────────
document.getElementById('togHoriz').addEventListener('click', () => setOrientation('H'));
document.getElementById('togVert').addEventListener('click', () => setOrientation('V'));

wireDrop('dzPDF', 'filePDF', 'namePDF', ['.pdf'], (file) => {
  // Reset stale seam UI from any previous PDF before kicking off detection.
  clearSeamUI();
  setState({ pdfFile: file, seamMethod: '' });
  // Drop the cache associated with the previous file (if any).
  delete file.__carvCache;
  updateBtn();
  logger.info('pdf.loaded', { name: file.name, size: file.size });

  // Kick off detection and store the promise so the Check handler can await it.
  const detect = autoDetectSeam(file)
    .then(({ angle, method }) => {
      // Only apply if this file is still the active one (user may have dropped
      // a different PDF while detection was running).
      if (state.pdfFile !== file) return;
      if (angle !== null) {
        seamInput.value = angle;
        seamInput.style.borderColor = 'var(--green)';
        seamInput.title = method;
        setState({ seamAngle: angle, seamMethod: method });
        logger.info('seam.detected', { angle, method });
      } else {
        logger.warn('seam.notDetected');
      }
    })
    .catch(err => {
      logger.warn('seam.detectFailed', { message: err.message });
    })
    .finally(() => {
      if (state.seamDetectInFlight === detect) setState({ seamDetectInFlight: null });
    });
  setState({ seamDetectInFlight: detect });
});

wireDrop('dzCNC', 'fileCNC', 'nameCNC', ['.cnc', '.txt'], (file) => {
  setState({ cncFile: file });
  updateBtn();
  logger.info('cnc.loaded', { name: file.name, size: file.size });
});

wireDebugToggle();

// ── Check handler ────────────────────────────────────────────────────────
checkBtn.addEventListener('click', async () => {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('results').style.display = 'none';

  try {
    // Wait for any in-flight seam autodetect so we don't read a stale 0°.
    if (state.seamDetectInFlight) {
      await state.seamDetectInFlight;
    }

    const seamRaw = seamInput.value.trim();
    const seamAngle = seamRaw === '' ? 0 : parseInt(seamRaw, 10);
    if (Number.isNaN(seamAngle) || seamAngle < 0 || seamAngle > 359) {
      throw new Error(`Invalid seam angle "${seamRaw}". Must be 0–359.`);
    }
    const seamDetected = seamRaw !== '';
    const seamMethod = seamInput.title || (seamDetected ? 'Entered manually' : '');

    logger.info('check.start', { orientation: state.orientation, seamAngle });
    const [cncText, pdfData] = await Promise.all([
      state.cncFile.text(),
      parsePDF(state.pdfFile),
    ]);
    const cncData = parseCNC(cncText);
    logger.info('parse.complete', {
      features: cncData.features.length,
      programId: cncData.programId,
      pipeSize: cncData.pipeSize,
      pipeSizeFromHeader: cncData.pipeSizeFromHeader,
      warnings: cncData.warnings,
    });

    const results = validateRun({
      cncData, pdfData,
      seamAngle,
      orientation: state.orientation,
      seamDetected,
    });
    results.seamMethod = seamMethod;
    setState({ results });

    renderResults(results);
    const circ = cncData.pipeSize ? cncData.pipeSize.circumference : DEFAULT_CIRCUMFERENCE;
    renderDebug(results, circ);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('results').style.display = 'block';
    logger.info('check.complete', {
      banner: results.banner.level,
      unmatchedCuts: results.unmatchedCuts.length,
    });
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    logger.error('check.failed', { message: err.message, stack: err.stack });
    toast('Error analyzing files: ' + err.message, 'error', 8000);
  }
});

// Expose logger for in-browser debugging:
//   window.__CARV_LOG__.history()   – array of entries
//   window.__CARV_LOG__.download()  – save log as JSON
window.__CARV_LOG__ = logger;
