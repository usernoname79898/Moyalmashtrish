'use strict';

/**
 * Currency vocabulary shared by every money field in the API.
 *
 * Two currencies are supported and they are never mixed: a UZS amount is only
 * ever shown, summed and exported next to (never added to) a USD amount, and no
 * automatic conversion exists anywhere. Every amount therefore carries its own
 * currency, and that currency is fixed at the moment the row is created: a
 * payment must match the currency of the record it pays down.
 *
 * The rules that differ per currency live here so the debt ledger, the
 * warehouse, the work journal and the expenses ledger cannot drift apart:
 *
 *   * UZS is stored in whole so'm. There is no subdivision in circulation, so a
 *     fractional so'm is not a rounding artefact to keep -- it is a typo, and it
 *     is refused rather than silently truncated.
 *   * USD is stored to the cent (two decimal places).
 */

const CURRENCIES = ['UZS', 'USD'];
const DEFAULT_CURRENCY = 'UZS';

const SYMBOLS = { UZS: "so'm", USD: '$' };
const LABELS = { UZS: "So'm (UZS)", USD: 'Dollar (USD)' };

/** Largest value NUMERIC(14,2) can hold without rounding. */
const MAX_AMOUNT = 999999999999.99;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isCurrency(value) {
  return CURRENCIES.includes(String(value == null ? '' : value).trim().toUpperCase());
}

/**
 * Returns a canonical currency code.
 *
 * An absent/empty value falls back to UZS (the historical default and the only
 * currency the app used before this feature), so an older client that does not
 * send a currency keeps working. Anything that is not one of the supported codes
 * is a 400 -- guessing at "usd " or "som" would be worse than refusing.
 */
function normalizeCurrency(value, { required = false } = {}) {
  const v = String(value == null ? '' : value).trim().toUpperCase();
  if (!v) {
    if (required) throw badRequest('Valyuta tanlanishi shart (UZS yoki USD)');
    return DEFAULT_CURRENCY;
  }
  if (!CURRENCIES.includes(v)) throw badRequest("Valyuta noto'g'ri: faqat UZS yoki USD");
  return v;
}

function moneySymbol(currency) {
  return SYMBOLS[currency] || SYMBOLS[DEFAULT_CURRENCY];
}

/**
 * Parses a money amount from JSON, honouring the currency's precision.
 *
 * The raw value is pattern-matched first: `parseFloat('12abc')` is 12 and
 * `parseFloat('1e9')` is 1000000000, both of which would silently record a wrong
 * figure on a financial ledger, so a JSON number is stringified and tested
 * exactly like a string (a numeric 1500.75 for UZS therefore fails the integer
 * pattern, which is the intended refusal).
 */
function parseMoney(value, field, currency = DEFAULT_CURRENCY) {
  const raw = typeof value === 'number' ? String(value) : String(value == null ? '' : value).trim();
  const pattern = currency === 'UZS' ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(raw)) {
    throw badRequest(
      currency === 'UZS'
        ? `${field} butun son (so'm) bo'lishi kerak (kasr va manfiy sonlar qabul qilinmaydi)`
        : `${field} noto'g'ri: USD uchun maksimum ikki xona kasr (masalan 1500.75)`
    );
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n > MAX_AMOUNT) throw badRequest(`${field} juda katta`);
  return n;
}

/** parseMoney for an optional field: absent/empty means zero. */
function parseMoneyOrZero(value, field, currency = DEFAULT_CURRENCY) {
  if (value === undefined || value === null || value === '') return 0;
  return parseMoney(value, field, currency);
}

module.exports = {
  CURRENCIES,
  DEFAULT_CURRENCY,
  SYMBOLS,
  LABELS,
  MAX_AMOUNT,
  isCurrency,
  normalizeCurrency,
  moneySymbol,
  parseMoney,
  parseMoneyOrZero,
};
