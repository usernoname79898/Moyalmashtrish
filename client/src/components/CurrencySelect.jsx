import React from 'react';
import { CURRENCIES, currencyLabel } from '../money';

/**
 * The UZS/USD picker shared by every money form.
 *
 * A plain select rather than a button pair, so it slots into the existing grid
 * forms without a layout change. Disabled once money has moved on a record: the
 * server refuses a currency change on a paid row, and a control that cannot work
 * is worse than no control.
 */
export default function CurrencySelect({ value, onChange, disabled = false, label = 'Valyuta' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="field" value={value} onChange={onChange} disabled={disabled}>
        {CURRENCIES.map((c) => (
          <option key={c} value={c} className="bg-[#111725]">{currencyLabel(c)}</option>
        ))}
      </select>
    </div>
  );
}
