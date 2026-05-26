import { PDF_TEXT_PREVIEW_MAX } from '../config/pdf.js';

/**
 * Render a validateRun() result object into the DOM. No business logic here —
 * just formatting and DOM updates. All file-derived strings are inserted via
 * textContent or createElement so a malformed/malicious XML/PDF can't inject HTML.
 */
export function renderResults(r) {
  // ── Pipe size cards ────────────────────────────────────────────────────
  setText('cPrintOD', r.printOD !== null ? r.printOD + '"' : 'Not found');
  setText('cCNCOD',   r.cncOD   !== null ? r.cncOD   + '"' : 'Not found');
  setText('cSizeCheck', r.sizePass ? '✓ MATCH' : '✗ MISMATCH');

  const sizeBadge = document.getElementById('cSizeBadge');
  if (sizeBadge) {
    sizeBadge.textContent = r.sizePass ? 'PASS' : 'FAIL';
    sizeBadge.className = 'card-badge ' + (r.sizePass ? 'badge-pass' : 'badge-fail');
  }

  setText('cSizeSub', r.pipeSize
    ? `Circ: ${r.pipeSize.circumference.toFixed(3)}", Wall: ${Number(r.pipeSize.thickness).toFixed(3)}"`
    : 'CNC header missing — using default');

  // ── Seam / formula / program cards ─────────────────────────────────────
  let seamValText = r.seamAngle + '°';
  let seamSubText = '';

  if (r.shellType === 'seamless') {
    seamValText = 'Seamless';
    seamSubText = 'Pipe — No seam offset needed';
  } else if (r.shellType === 'welded-pipe') {
    seamValText = r.seamDetected ? r.seamAngle + '°' : 'Manual';
    seamSubText = 'Welded Pipe — Custom alignment';
  } else {
    seamValText = r.seamAngle + '°';
    seamSubText = r.seamMethod || 'Rolled Plate Seam';
  }

  setText('cSeam', seamValText);
  setText('cSeamSub', seamSubText);
  
  setText('cOffset', r.orientation === 'V' ? 'Vertical' : 'Horizontal');
  setText('cOffsetSub', r.orientation === 'V'
    ? `RTP = (${r.seamAngle}° − print°) % 360`
    : `RTP = (360 − ${r.seamAngle}° + print°) % 360`);
  setText('cProgram', r.programId || 'Unknown');
  
  const seamWarn = document.getElementById('seamWarn');
  if (seamWarn) {
    seamWarn.style.display = r.seamDetected ? 'none' : 'block';
  }

  // ── Parser warnings (e.g. missing CNC header, unclosed feature) ───────
  renderWarnings(r.warnings || []);

  // ── Nozzle cuts table ──────────────────────────────────────────────────
  const nozzleCountEl = document.getElementById('cutCount');
  const thead = document.getElementById('tblCutsHead');
  const tbodyCuts = document.getElementById('tbodyCuts');
  
  if (tbodyCuts) {
    tbodyCuts.innerHTML = '';

    if (r.nozzles.length > 0) {
      if (nozzleCountEl) {
        nozzleCountEl.textContent =
          `${r.nozzleResults.length} nozzle${r.nozzleResults.length !== 1 ? 's' : ''} · ` +
          `${r.cuts.length} CNC cut${r.cuts.length !== 1 ? 's' : ''}`;
      }
      if (thead) {
        setHeader(thead, ['Nozzle', 'Print Angle', 'Expected RTP', 'CNC Angle', 'Axial X', 'Status']);
      }
      r.nozzleResults.forEach(nr => {
        const statusText = nr.status === 'pass' ? 'MATCH' : nr.status === 'warn' ? 'WARN' : 'REVIEW';
        const tr = document.createElement('tr');
        appendCell(tr, '', el => {
          const lbl = document.createElement('span');
          lbl.className = 'nozzle-label';
          lbl.textContent = nr.nozzle.name;
          el.appendChild(lbl);
          if (nr.nozzle.label) {
            const sub = document.createElement('span');
            sub.className = 'nozzle-sub';
            sub.textContent = ' ' + nr.nozzle.label;
            el.appendChild(sub);
          }
        });
        appendCell(tr, nr.nozzle.baseDeg + '°', null, 'mono');
        appendCell(tr, nr.expectedRTP.toFixed(1) + '°', null, 'mono');
        appendCell(tr, nr.bestCut ? nr.bestCut.deg.toFixed(1) + '°' : '—', null, 'mono');
        appendCell(tr, nr.bestCut ? nr.bestCut.x.toFixed(2) + '"' : '—', null, 'mono');
        appendCell(tr, statusText, null, nr.status);
        tbodyCuts.appendChild(tr);
      });

      // Unmatched cuts: cuts that no nozzle claimed. Surface explicitly.
      if (r.unmatchedCuts && r.unmatchedCuts.length > 0) {
        r.unmatchedCuts.forEach(cut => {
          const tr = document.createElement('tr');
          tr.className = 'unmatched-row';
          appendCell(tr, '', el => {
            const lbl = document.createElement('span');
            lbl.className = 'nozzle-label';
            lbl.textContent = 'UNMATCHED';
            el.appendChild(lbl);
          });
          appendCell(tr, '—', null, 'mono');
          appendCell(tr, '—', null, 'mono');
          appendCell(tr, cut.deg.toFixed(1) + '°', null, 'mono');
          appendCell(tr, cut.x.toFixed(2) + '"', null, 'mono');
          appendCell(tr, 'REVIEW', null, 'fail');
          tbodyCuts.appendChild(tr);
        });
      }
    } else {
      // No nozzle schedule detected — fall back to showing all raw CNC cuts.
      if (nozzleCountEl) {
        nozzleCountEl.textContent =
          `${r.cuts.length} CNC cut${r.cuts.length !== 1 ? 's' : ''} (no schedule detected)`;
      }
      if (thead) {
        setHeader(thead, ['#', 'CNC Angle', 'Axial X', 'Note']);
      }
      r.cuts.forEach((cut, i) => {
        const tr = document.createElement('tr');
        appendCell(tr, '', el => {
          const lbl = document.createElement('span');
          lbl.className = 'nozzle-label';
          lbl.textContent = '#' + (i + 1);
          el.appendChild(lbl);
        });
        appendCell(tr, cut.deg.toFixed(1) + '°', null, 'mono');
        appendCell(tr, cut.x.toFixed(2) + '"', null, 'mono');
        const note = document.createElement('td');
        note.style.color = 'var(--text-dim)';
        note.textContent = 'Verify against drawing';
        tr.appendChild(note);
        tbodyCuts.appendChild(tr);
      });

      if (r.cuts.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.style.cssText = 'color:var(--text-dim);text-align:center;padding:20px;';
        td.textContent = 'No cuts found in CNC program';
        tr.appendChild(td);
        tbodyCuts.appendChild(tr);
      }
    }
  }

  // ── End cuts table ─────────────────────────────────────────────────────
  const endCutHeader = document.getElementById('endCutHeader');
  const endCutWrap   = document.getElementById('endCutWrap');
  const tbodyEndCuts = document.getElementById('tbodyEndCuts');
  
  if (tbodyEndCuts) {
    tbodyEndCuts.innerHTML = '';

    if (r.endCuts.length > 0) {
      if (endCutHeader) endCutHeader.style.display = 'flex';
      if (endCutWrap) endCutWrap.style.display = 'block';
      setText('endCutCount', `${r.endCuts.length} end cut${r.endCuts.length !== 1 ? 's' : ''}`);
      r.endCuts.forEach((cut, i) => {
        const side = i === 0 ? 'Left / Near End' : 'Right / Far End';
        const tr = document.createElement('tr');
        tr.className = 'endcut-row';
        appendCell(tr, 'END CUT', null, 'endcut');
        appendCell(tr, cut.deg.toFixed(1) + '°', null, 'mono');
        appendCell(tr, cut.x.toFixed(2) + '"', null, 'mono');
        const sideCell = document.createElement('td');
        sideCell.style.color = 'var(--text-dim)';
        sideCell.textContent = side;
        tr.appendChild(sideCell);
        tbodyEndCuts.appendChild(tr);
      });
    } else {
      if (endCutHeader) endCutHeader.style.display = 'none';
      if (endCutWrap) endCutWrap.style.display = 'none';
    }
  }

  // ── Scribes (dedup by 5° buckets) ──────────────────────────────────────
  setText('scribeCount', r.scribes.length + ' scribes');
  const scribeGrid = document.getElementById('scribeGrid');
  if (scribeGrid) {
    scribeGrid.innerHTML = '';
    const seen = new Set();
    r.scribes.forEach(s => {
      const key = Math.round(s.deg / 5) * 5;
      if (seen.has(key)) return;
      seen.add(key);
      const chip = document.createElement('div');
      chip.className = 'scribe-chip';
      const a = document.createElement('div'); a.className = 'sc-label'; a.textContent = 'SCRIBE';
      const b = document.createElement('div'); b.className = 'sc-val';   b.textContent = `X: ${s.x.toFixed(2)}"`;
      const c = document.createElement('div'); c.className = 'sc-val';   c.textContent = `${s.deg.toFixed(1)}° RTP`;
      chip.append(a, b, c);
      scribeGrid.appendChild(chip);
    });
  }

  // ── Banner + XML text (capped) ─────────────────────────────────────────
  const banner = document.getElementById('statusBanner');
  if (banner) {
    banner.textContent = r.banner.text;
    banner.className = 'status-banner ' + r.banner.level;
  }

  const text = r.pdfRawText || '';
  if (text.length > PDF_TEXT_PREVIEW_MAX) {
    setText('xmlText',
      text.slice(0, PDF_TEXT_PREVIEW_MAX) +
      `\n\n…[truncated — ${text.length - PDF_TEXT_PREVIEW_MAX} more characters]`);
  } else {
    setText('xmlText', text);
  }
}

function renderWarnings(warnings) {
  let host = document.getElementById('parserWarnings');
  const seamWarn = document.getElementById('seamWarn');
  
  if (!host && seamWarn) {
    host = document.createElement('div');
    host.id = 'parserWarnings';
    host.className = 'parser-warnings';
    seamWarn.parentNode.insertBefore(host, seamWarn.nextSibling);
  }
  
  if (host) {
    host.innerHTML = '';
    if (warnings.length === 0) { host.style.display = 'none'; return; }
    host.style.display = 'block';
    warnings.forEach(w => {
      const div = document.createElement('div');
      div.className = 'parser-warning';
      div.textContent = '⚠️ ' + w;
      host.appendChild(div);
    });
  }
}

function setHeader(thead, cols) {
  thead.innerHTML = '';
  const tr = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
}

function appendCell(tr, text, builder, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  if (builder) builder(td);
  else td.textContent = text;
  tr.appendChild(td);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  } else {
    console.warn(`[CARV] Element not found: #${id}`);
  }
}
