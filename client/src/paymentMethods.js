/**
 * The payment methods the workshop takes, as the app shows them.
 *
 * Plain data, no JSX and no React, so the values the work-log form offers can
 * be asserted directly.
 *
 * `paymentMethodOptions(current)` returns the list for a <select> that is
 * pre-filled with an existing record. A method that is not on the list any more
 * -- a free-text value written before the picker existed -- is still offered
 * back, labelled "(eski)", so editing such a record never quietly rewrites
 * what it was filed with. The same rule the service catalogue follows.
 */

/** The methods on offer, in the order they are offered. */
export const PAYMENT_METHODS = ['Naqd pul', 'Karta', "O'tkazma"];

/**
 * Options for a <select> that is pre-filled with an existing record.
 *
 * @param {string} current value already on the record
 * @returns {{ value: string, label: string, legacy: boolean }[]}
 */
export function paymentMethodOptions(current) {
  const cur = String(current == null ? '' : current).trim();
  const options = PAYMENT_METHODS.map((m) => ({ value: m, label: m, legacy: false }));
  if (cur && !PAYMENT_METHODS.includes(cur)) {
    options.unshift({ value: cur, label: `${cur} (eski)`, legacy: true });
  }
  return options;
}
