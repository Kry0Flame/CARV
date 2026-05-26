/**
 * CARV XML Parser
 * Extracts Outer Diameter, Vessel Orientation, Seam Angle, and Nozzle Schedule
 * from Codeware COMPRESS XML exports using standard browser DOMParser in a
 * namespace-insensitive, highly robust manner.
 */

/**
 * @typedef {Object} NozzleDef
 * @property {string} name     e.g. "COIL RETURN #2 (3)"
 * @property {number} baseDeg  print/orientation angle (0–359)
 * @property {string} label    additional details if any
 */

/**
 * @typedef {Object} XMLData
 * @property {number|null} od
 * @property {'H'|'V'} orientation
 * @property {number} seamAngle
 * @property {string} seamMethod
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

  // 2. Extract Seam Angle
  let seamAngle = 0;
  let seamMethod = 'Not detected';
  const seamEl = getElementsByLocalName(xmlDoc, 'LongSeamStartingAngle')[0];
  if (seamEl) {
    const val = parseFloat(seamEl.textContent);
    if (!Number.isNaN(val)) {
      seamAngle = val;
      seamMethod = 'Auto-detected (XML)';
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

    nozzles.push({
      name,
      baseDeg: ((baseDeg % 360) + 360) % 360, // Normalize to 0-359
      label: '', // The user requested to use the calculation identifier as name, so label is empty
    });
  }

  // Sort nozzles by their parsed index or naturally by name
  nozzles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return {
    od,
    orientation,
    seamAngle,
    seamMethod,
    nozzles,
    rawText: xmlText,
  };
}
