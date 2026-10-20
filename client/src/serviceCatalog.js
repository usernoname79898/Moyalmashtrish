/**
 * The service catalogue as the app shows it.
 *
 * Deliberately free of JSX and of React, so the values the screens offer are
 * plain data that can be asserted directly. This is the bundled baseline; the
 * live list comes from the server (`client/src/serviceTypes.js`, backed by the
 * `services` table that /admin/services edits).
 *
 * `serviceOptions(current, names)` takes the live list and falls back to the
 * baseline below while it is loading. `DebtLedger.jsx`, `WorkLogs.jsx`,
 * `AdminLogin.jsx`, `Footer.jsx` and `WorkGallery.jsx` all draw from here.
 *
 * `LEGACY_SERVICE_NAME` is the retired combined label from the previous
 * (mechanical) catalogue. It is never offered, but a record filed before the
 * switch must still render and stay editable.
 */

/** The six auto-electrical services, in the order they are offered. */
export const SERVICE_NAMES = [
  'Elektrodiagnostika',
  'Elektr simlari',
  'Starter va generator',
  'Akkumulyator',
  'Yoritish tizimi',
  'ECU va sensorlar',
];

/** Retired combined name. Never selectable; still valid on an old record. */
export const LEGACY_SERVICE_NAME = 'Mator xodovoy';

/** Icons, keyed by service name. Unknown names fall back to `wrench`. */
export const SERVICE_ICONS = {
  Elektrodiagnostika: 'diagnostic',
  'Elektr simlari': 'bolt',
  'Starter va generator': 'refresh',
  Akkumulyator: 'battery',
  'Yoritish tizimi': 'light',
  'ECU va sensorlar': 'chip',
  [LEGACY_SERVICE_NAME]: 'engine',
};

/** True for a name the shop currently offers. */
export function isServiceName(name) {
  return SERVICE_NAMES.includes(String(name == null ? '' : name).trim());
}

/**
 * Options for a <select> that is pre-filled with an existing record.
 *
 * The current value is appended when it is not in the catalogue, otherwise an
 * edit form would open showing a service the record does not have and saving
 * would quietly rewrite it. That is how a legacy record survives being edited:
 * its own value is offered back, labelled as legacy, and the operator has to
 * actively pick something else to change it.
 *
 * `names` is the live catalogue (client/src/serviceTypes.js), so the work-log
 * and debt pickers follow the services the admin has actually added. Left out it
 * falls back to the bundled baseline six -- the guaranteed floor while that
 * request is in flight or has failed.
 *
 * @param {string} current value already on the record
 * @param {string[]} [names] active service names, in catalogue order
 * @returns {{ value: string, label: string, legacy: boolean }[]}
 */
export function serviceOptions(current, names) {
  const cur = String(current == null ? '' : current).trim();
  const list = Array.isArray(names) ? names.map((n) => String(n)) : SERVICE_NAMES;
  const options = list.map((name) => ({ value: name, label: name, legacy: false }));
  if (cur && !list.includes(cur)) {
    options.unshift({ value: cur, label: `${cur} (eski)`, legacy: true });
  }
  return options;
}

/** Icon for a service name, falling back to the generic wrench. */
export function serviceIcon(name) {
  return SERVICE_ICONS[String(name == null ? '' : name).trim()] || 'wrench';
}
