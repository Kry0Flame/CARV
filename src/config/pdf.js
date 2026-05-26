/**
 * Tuning constants for PDF spatial extraction. Centralized so calibration
 * against new drawing templates is reviewable in one place.
 */
export const PDF_TUNING = {
  // Items within this Y-delta (PDF units) are clustered into the same row
  // when looking for nozzle schedules.
  rowToleranceY: 6,

  // Spatial seam-angle search: a candidate angle must be within this many
  // PDF units of the "SEAM" label to be accepted. 300 ≈ ~4 inches at 72 dpi.
  seamMaxDistance: 300,

  // Proximity-fallback window (characters) on either side of "SEAM" when
  // doing the text-pattern search in seam.js.
  seamTextWindow: 40,
};

// Limit how much PDF text is dumped into the DOM. Drawings with embedded
// notes/specs can generate hundreds of KB and tank rendering.
export const PDF_TEXT_PREVIEW_MAX = 50_000;
