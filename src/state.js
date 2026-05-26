/**
 * Single source of truth for app state. Plain mutable object — no observer
 * pattern, since the current UI flow is fully driven by explicit event handlers.
 */
export const state = {
  /** @type {File|null} */               xmlFile: null,
  /** @type {File|null} */               cncFile: null,
  /** @type {'H'|'V'} */                 orientation: 'H',
  /** @type {number|null} */             seamAngle: null,
  /** @type {string} */                  seamMethod: '',
  /** @type {object|null} */             results: null,
};

export function setState(patch) {
  Object.assign(state, patch);
}
