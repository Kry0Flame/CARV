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
import { parseXML } from './parsers/xml.js';
import { validateRun } from './domain/validate.js';
import { DEFAULT_CIRCUMFERENCE } from './config/nozzles.js';
import { logger } from './lib/logger.js';

const seamInput = document.getElementById('seamAngle');
const checkBtn  = document.getElementById('btnCheck');

function updateBtn() {
  if (state.xmlFile && state.cncFile) {
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

wireDrop('dzXML', 'fileXML', 'nameXML', ['.xml'], (file) => {
  // Reset stale seam UI from any previous XML before kicking off detection.
  clearSeamUI();
  setState({ xmlFile: file, seamMethod: '' });
  // Drop the cache associated with the previous file (if any).
  delete file.__carvCache;
  updateBtn();
  logger.info('xml.loaded', { name: file.name, size: file.size });

  // Pre-parse XML for metadata auto-configuration (orientation and seam angle)
  file.text().then(xmlText => {
    if (state.xmlFile !== file) return;
    try {
      const xmlData = parseXML(xmlText);
      
      // Auto-set orientation
      setOrientation(xmlData.orientation);

      // Auto-configure seam angle UI based on shell classification
      if (xmlData.shellType === 'seamless') {
        seamInput.value = 0;
        seamInput.style.borderColor = 'var(--green)';
        seamInput.title = 'Seamless Pipe — No seam offset needed';
        setState({ seamAngle: 0, seamMethod: xmlData.seamMethod });
        logger.info('xml.seamTypeSeamless');
      } else if (xmlData.shellType === 'welded-pipe') {
        seamInput.value = '';
        seamInput.style.borderColor = 'var(--yellow)';
        seamInput.title = 'Welded Pipe — Requires manual weld seam entry based on machine load';
        setState({ seamAngle: 0, seamMethod: xmlData.seamMethod });
        logger.info('xml.seamTypeWeldedPipe');
      } else {
        // Rolled Shell - Auto-populate detected seam angle
        seamInput.value = xmlData.seamAngle;
        seamInput.style.borderColor = 'var(--green)';
        seamInput.title = xmlData.seamMethod;
        setState({ seamAngle: xmlData.seamAngle, seamMethod: xmlData.seamMethod });
        logger.info('xml.seamTypeRolledPlate', { seamAngle: xmlData.seamAngle });
      }
    } catch (err) {
      logger.warn('xml.preParseFailed', { message: err.message });
    }
  }).catch(err => {
    logger.warn('xml.readFailed', { message: err.message });
  });
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
    const seamRaw = seamInput.value.trim();
    const seamAngle = seamRaw === '' ? 0 : parseInt(seamRaw, 10);
    if (Number.isNaN(seamAngle) || seamAngle < 0 || seamAngle > 359) {
      throw new Error(`Invalid seam angle "${seamRaw}". Must be 0–359.`);
    }
    const seamDetected = seamRaw !== '';
    const seamMethod = seamInput.title || (seamDetected ? 'Entered manually' : '');

    logger.info('check.start', { orientation: state.orientation, seamAngle });
    const [cncText, xmlText] = await Promise.all([
      state.cncFile.text(),
      state.xmlFile.text(),
    ]);
    const xmlData = parseXML(xmlText);
    const cncData = parseCNC(cncText);
    logger.info('parse.complete', {
      features: cncData.features.length,
      programId: cncData.programId,
      pipeSize: cncData.pipeSize,
      pipeSizeFromHeader: cncData.pipeSizeFromHeader,
      warnings: cncData.warnings,
    });

    const results = validateRun({
      cncData,
      pdfData: xmlData, // Keeping key as pdfData in domain parameter to prevent changes to validation engine
      seamAngle,
      orientation: state.orientation,
      seamDetected,
    });
    results.seamMethod = seamMethod;
    results.shellType = xmlData.shellType;
    results.productForm = xmlData.productForm;
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
