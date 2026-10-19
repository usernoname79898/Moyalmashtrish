// Currency vocabulary shared by the admin money screens.
//
// Two currencies exist and they are never mixed: a UZS figure and a USD figure
// are shown side by side, never added together. The formatting differs on
// purpose -- so'm has no subdivision in circulation, the dollar keeps its cents
// -- so a USD amount is not rendered with the so'm grouping.

export const CURRENCIES = ['UZS', 'USD'];
export const DEFAULT_CURRENCY = 'UZS';

export const CURRENCY_LABELS = { UZS: "So'm (UZS)", USD: 'Dollar (USD)' };
export const CURRENCY_SYMBOLS = { UZS: "so'm", USD: '$' };

/**
 * 250000 -> "250 000 so'm"; 1500.75 USD -> "$1,500.75".
 *
 * The so'm branch keeps the locale's decimal comma (the warehouse stores
 * two-decimal prices) and only turns the non-breaking group separator into a
 * plain space, so 185000.5 reads "185 000,5 so'm" rather than the old
 * "185 000 5 so'm" a blanket comma-to-space rewrite produced.
 */
export function money(n, currency = DEFAULT_CURRENCY) {
  const v = Number(n || 0);
  if (currency === 'USD') {
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const grouped = v
    .toLocaleString('ru-RU', { maximumFractionDigits: 2 })
    .replace(/[\u00A0\u202F]/g, ' ');
  return `${grouped} so'm`;
}

/** The bare symbol, for labels such as "qoldiq 200 000 so'm". */
export function symbolOf(currency) {
  return CURRENCY_SYMBOLS[currency] || CURRENCY_SYMBOLS[DEFAULT_CURRENCY];
}

export function currencyLabel(currency) {
  return CURRENCY_LABELS[currency] || CURRENCY_LABELS[DEFAULT_CURRENCY];
}
