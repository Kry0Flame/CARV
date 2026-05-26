/**
 * Convert a print angle (as shown on the certified drawing) to an RTP machine
 * angle. The seam angle drives the offset; orientation flips the direction.
 *
 *   Horizontal: RTP = (360 - seam + printDeg) % 360
 *   Vertical:   RTP = (seam - printDeg + 360) % 360
 *
 * @param {number} printDeg
 * @param {number} seamAngle
 * @param {'H'|'V'} orientation
 * @returns {number}
 */
export function printToRTP(printDeg, seamAngle, orientation) {
  if (orientation === 'V') return (seamAngle - printDeg + 360) % 360;
  return (360 - seamAngle + printDeg) % 360;
}

/**
 * Smallest angular distance between two angles, in degrees.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function angularDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
