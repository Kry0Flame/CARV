/**
 * CARV XML Parser
 * Extracts Outer Diameter, Vessel Orientation, Seam Angle, Shell Type,
 * and Nozzle Schedule (with custom sorting prioritized by drawing mark)
 * from Codeware COMPRESS XML exports.
 */

/**
 * @typedef {Object} NozzleDef
 * @property {string} name     e.g. "COIL RETURN #2 (3)"
 * @property {number} baseDeg  print/orientation angle (0–359)
 * @property {string} label    NPS and schedule details
 * @property {number} category 1 = Pipe, 2 = Coupling, 3 = Other
 * @property {number} nominalSize NPS float size for sorting
 * @property {number} markNumber Mark number in parentheses for sorting
 */

/**
 * @typedef {Object} XMLData
 * @property {number|null} od
 * @property {'H'|'V'} orientation
 * @property {number} seamAngle
 * @property {string} seamMethod
 * @property {'seamless'|'welded-pipe'|'rolled-shell'} shellType
 * @property {string} productForm
 * @property {NozzleDef[]} nozzles
 * @property {string} rawText
 */

/**
 * Helper to retrieve child elements by their local tag name (namespace-insensitive).
 *
 * @param {Element|Document} parent
 * @param {string} localName
 * @returns {Element[]}
 */
function getElementsByLocalName(parent, localName) {
  if (!parent) return [];
  const all = parent.getElementsByTagName('*');
  const matched = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) {
      matched.push(all[i]);
    }
  }
  return matched;
}

/**
 * Parse Codeware COMPRESS XML data.
 *
 * @param {string} xmlText
 * @returns {XMLData}
 */
export function parseXML(xmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

  // Check for XML parsing errors
  const parserError = getElementsByLocalName(xmlDoc, 'parsererror')[0];
  if (parserError) {
    throw new Error('XML parsing failed: ' + parserError.textContent);
  }

  // 1. Extract General Vessel Info (OD and Orientation)
  const generalVesselInfo = getElementsByLocalName(xmlDoc, 'generalVesselInfo')[0];
  let od = null;
  let orientation = 'H';

  if (generalVesselInfo) {
    const odEl = getElementsByLocalName(generalVesselInfo, 'outerDiameter')[0];
    if (odEl) {
      od = parseFloat(odEl.textContent);
      if (Number.isNaN(od)) od = null;
    }

    const orientEl = getElementsByLocalName(generalVesselInfo, 'orientation')[0];
    if (orientEl) {
      const orientText = orientEl.textContent.trim().toLowerCase();
      if (orientText === 'vertical' || orientText.startsWith('v')) {
        orientation = 'V';
      } else {
        orientation = 'H';
      }
    }
  }

  // 2. Determine Shell Type and Seam Angle Logic
  const cylinder = getElementsByLocalName(xmlDoc, 'cylinder')[0];
  let productForm = '';
  let shellType = 'rolled-shell';
  let seamAngle = 0;
  let seamMethod = 'Not detected';

  if (cylinder) {
    const compData = getElementsByLocalName(cylinder, 'standardComponentData')[0];
    if (compData) {
      const mat2 = getElementsByLocalName(compData, 'material2')[0];
      if (mat2) {
        const prodFormEl = getElementsByLocalName(mat2, 'productForm')[0];
        if (prodFormEl) {
          productForm = prodFormEl.textContent.trim();
        }
      }
    }
  }

  const prodFormLower = productForm.toLowerCase();
  
  if (prodFormLower.includes('smls') || prodFormLower.includes('seamless')) {
    shellType = 'seamless';
    seamAngle = 0;
    seamMethod = 'Seamless Pipe (no seam needed)';
  } else if (prodFormLower.includes('pipe')) {
    shellType = 'welded-pipe';
    seamAngle = 0;
    seamMethod = 'Welded Pipe (manual input required)';
  } else {
    shellType = 'rolled-shell';
    
    if (cylinder) {
      const longSeam = getElementsByLocalName(cylinder, 'longSeam')[0];
      if (longSeam) {
        const seamAngleEl = getElementsByLocalName(longSeam, 'longSeamAngle')[0];
        if (seamAngleEl) {
          const val = parseFloat(seamAngleEl.textContent);
          if (!Number.isNaN(val)) {
            seamAngle = val;
            seamMethod = 'Auto-detected (XML longSeamAngle)';
          }
        }
      }
    }
    
    if (seamMethod === 'Not detected') {
      const globalSeamEl = getElementsByLocalName(xmlDoc, 'LongSeamStartingAngle')[0];
      if (globalSeamEl) {
        const val = parseFloat(globalSeamEl.textContent);
        if (!Number.isNaN(val)) {
          seamAngle = val;
          seamMethod = 'Auto-detected (XML LongSeamStartingAngle)';
        }
      }
    }
  }

  // 3. Extract Nozzles
  const nozzles = [];
  const nozzleEls = getElementsByLocalName(xmlDoc, 'nozzle');

  for (let i = 0; i < nozzleEls.length; i++) {
    const nEl = nozzleEls[i];
    const idEl = getElementsByLocalName(nEl, 'identifier')[0];
    const angleEl = getElementsByLocalName(nEl, 'orientationAngle')[0];

    if (!angleEl) continue;

    const baseDeg = parseFloat(angleEl.textContent);
    if (Number.isNaN(baseDeg)) continue;

    const name = idEl ? idEl.textContent.trim() : `Nozzle #${i + 1}`;

    // Size details
    let npsText = '';
    const npsEl = getElementsByLocalName(nEl, 'pipeNPSandSchedule')[0];
    if (npsEl) {
      npsText = npsEl.textContent.trim();
    }

    let nOuterDiameter = 0;
    const odEl = getElementsByLocalName(nEl, 'outerDiameter')[0];
    if (odEl) {
      nOuterDiameter = parseFloat(odEl.textContent) || 0;
    }

    // Material details to classify as pipe, coupling, or other
    let nProductForm = '';
    let nMaterial = '';
    const compData = getElementsByLocalName(nEl, 'standardComponentData')[0];
    if (compData) {
      const matEl = getElementsByLocalName(compData, 'material')[0];
      if (matEl) nMaterial = matEl.textContent.trim();

      const mat2 = getElementsByLocalName(compData, 'material2')[0];
      if (mat2) {
        const pfEl = getElementsByLocalName(mat2, 'productForm')[0];
        if (pfEl) nProductForm = pfEl.textContent.trim();
      }
    }

    // Classification Category:
    // 1 = Pipe (contains 'pipe' or 'tube')
    // 2 = Coupling (contains 'coupling', 'cplg', or 'fitting')
    // 3 = Other
    let category = 3;
    const matchText = `${name} ${nProductForm} ${nMaterial} ${npsText}`.toLowerCase();
    
    if (matchText.includes('pipe') || matchText.includes('tube')) {
      category = 1;
    } else if (matchText.includes('coupling') || matchText.includes('cplg') || matchText.includes('fitting')) {
      category = 2;
    }

    // Parse NPS float size for robust sorting (e.g. 1.5, 3, 5)
    let nominalSize = nOuterDiameter; 
    const npsMatch = npsText.match(/NPS\s+([\d.]+)/i);
    if (npsMatch) {
      const parsedSize = parseFloat(npsMatch[1]);
      if (!Number.isNaN(parsedSize)) {
        nominalSize = parsedSize;
      }
    }

    // Parse mark number in parenthesis at the end (e.g. "COIL FEED #1 (4)" -> 4)
    let markNumber = 999;
    const markMatch = name.match(/\((\d+)\)[^\(]*$/);
    if (markMatch) {
      const parsedMark = parseInt(markMatch[1], 10);
      if (!Number.isNaN(parsedMark)) {
        markNumber = parsedMark;
      }
    }

    nozzles.push({
      name,
      baseDeg: ((baseDeg % 360) + 360) % 360, // Normalize to 0-359
      label: npsText ? `(${npsText})` : `(${nOuterDiameter}" OD)`,
      category,
      nominalSize,
      markNumber,
    });
  }

  // Custom Sort Logic:
  // 1. Pipes first (category 1), then Couplings (category 2), then Others (category 3)
  // 2. Within each category, largest nominal size to smallest nominal size (nominalSize descending)
  // 3. Within matching sizes, sort by mark number ascending (markNumber ascending: (1), then (2), then (3))
  // 4. Alphabetically by name for other fallbacks
  nozzles.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category - b.category;
    }
    if (a.nominalSize !== b.nominalSize) {
      return b.nominalSize - a.nominalSize; // Descending (largest to smallest)
    }
    if (a.markNumber !== b.markNumber) {
      return a.markNumber - b.markNumber; // Ascending ((1) before (2))
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    od,
    orientation,
    seamAngle,
    seamMethod,
    shellType,
    productForm,
    nozzles,
    rawText: xmlText,
  };
}
