// Decimal amount fields — shared by every amount input in the app.

/**
 * Normalizes what the user types into a decimal amount field to the "1234.56" form the
 * whole app parses (parseFloat, BigInt parsing, quotes…). Locales that type a decimal
 * COMMA (pl, de, fr, es…) would otherwise yield parseFloat("0,5") === 0, silently
 * breaking estimates. Comma → dot, only digits and ONE dot kept (no minus, no exponent).
 */
export function normalizeDecimalInput(value) {
  let s = String(value ?? '').replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const i = s.indexOf('.')
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '')
  return s
}

/** onKeyDown for decimal fields: keys that can never be part of an amount. */
export function blockNonDecimalKeys(e) {
  if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault()
}
