import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import Icon from '../../components/icons';
import { Loading, Alert, Badge, Modal } from '../../components/ui';
import { CURRENCIES, DEFAULT_CURRENCY, money, currencyLabel, symbolOf } from '../../money';

const STATUS_META = {
  unpaid: { label: "To'lanmagan", badge: 'danger', row: 'bg-red-500/[0.04]' },
  partially_paid: { label: "Qisman to'langan", badge: 'warn', row: '' },
  paid: { label: "To'langan", badge: 'success', row: '' },
};

const CATEGORIES = [
  { key: 'oil', label: 'Moy' },
  { key: 'filter', label: 'Filtr' },
  { key: 'service', label: 'Xizmat' },
  { key: 'other', label: 'Boshqa' },
];

const FILTERS = [
  { key: 'all', label: 'Barcha' },
  { key: 'unpaid', label: "To'lanmagan" },
  { key: 'partially_paid', label: "Qisman to'langan" },
  { key: 'paid', label: "To'langan" },
  { key: 'archive', label: 'Arxiv' },
];

const SORTS = [
  { key: 'newest', label: 'Eng yangi' },
  { key: 'oldest', label: 'Eng eski' },
  { key: 'largest', label: 'Eng katta summa' },
  { key: 'remaining', label: 'Eng katta qoldiq' },
];

function categoryLabel(key) {
  const c = CATEGORIES.find((x) => x.key === key);
  return c ? c.label : key;
}

/** Small currency picker used by every money form on this page. */
function CurrencySelect({ value, onChange, disabled = false }) {
  return (
    <select className="field" value={value} onChange={onChange} disabled={disabled}>
      {CURRENCIES.map((c) => (
        <option key={c} value={c} className="bg-[#111725]">{currencyLabel(c)}</option>
      ))}
    </select>
  );
}

export default function Expenses() {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState({ page: 1, per_page: 20, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('');
  const [currency, setCurrency] = useState('');
  const [sort, setSort] = useState('newest');
  const [currentPage, setCurrentPage] = useState(1);

  const [masters, setMasters] = useState([]);

  const [addOpen, setAddOpen] = useState(false);
  const [editFor, setEditFor] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    api.get('/admin/users').then(({ users }) => setMasters((users || []).filter((u) => u.role === 'master'))).catch(() => {});
  }, []);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ filter, sort, page: String(currentPage), per_page: '20' });
    if (search) params.set('q', search);
    if (category) params.set('category', category);
    if (currency) params.set('currency', currency);
    return params;
  }, [filter, sort, currentPage, search, category, currency]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, list] = await Promise.all([
        api.get('/admin/expenses/stats'),
        api.get(`/admin/expenses?${buildParams().toString()}`),
      ]);
      setStats(s.stats);
      setRows(list.expenses || []);
      setPage(list.pagination || { page: currentPage, per_page: 20, total: 0, pages: 1 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [buildParams, currentPage]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const moneyStats = useMemo(() => (stats && stats.currencies ? stats.currencies : []), [stats]);

  const cards = useMemo(() => {
    if (!stats) return [];
    return [
      { label: 'Jami hisob', value: stats.total, icon: 'money', color: 'bg-[rgb(var(--c-primary))]' },
      { label: "To'lanmagan", value: stats.unpaid, icon: 'clock', color: 'bg-red-500' },
      { label: "Qisman to'langan", value: stats.partiallyPaid, icon: 'updown', color: 'bg-amber-500' },
      { label: "To'langan", value: stats.paid, icon: 'check', color: 'bg-emerald-500' },
    ];
  }, [stats]);

  const onDeleted = async () => {
    setDeleteTarget(null);
    setNotice("Hisob arxivlandi.");
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Moy hisob-kitob</h1>
          <p className="mt-1 text-sm text-white/50">
            Moy, filtr va xizmatlar uchun yuritiladigan hisob: to'langan, qolgan va yetkazib beruvchi.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <CsvButton params={buildParams()} onError={setError} />
          <button type="button" onClick={() => setAddOpen(true)} className="btn-primary flex items-center gap-2 !py-2.5 text-sm">
            <Icon name="pluss" size={16} /> Hisob qo'shish
          </button>
        </div>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="flex items-center gap-4">
              <span className={`flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-lg ${c.color}`}>
                <Icon name={c.icon} size={22} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-xl font-extrabold tracking-tight">{c.value}</div>
                <div className="text-xs text-white/50">{c.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Money is never mixed: one value card per currency, always both shown. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {moneyStats.map((m) => (
          <div key={m.currency} className="card p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/45">
              {currencyLabel(m.currency)}
            </div>
            <div className="mt-2 text-lg font-extrabold text-white">{money(m.totalAmount, m.currency)}</div>
            <div className="mt-1 flex justify-between text-xs">
              <span className="text-emerald-300/90">To'langan {money(m.totalPaid, m.currency)}</span>
            </div>
            <div className="mt-0.5 flex justify-between text-xs">
              <span className="text-red-300">Qolgan {money(m.totalRemaining, m.currency)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="label">Qidirish</label>
            <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nomi, yetkazib beruvchi yoki telefon" />
          </div>
          <div>
            <label className="label">Holat</label>
            <select className="field" value={filter} onChange={(e) => { setFilter(e.target.value); setCurrentPage(1); }}>
              {FILTERS.map((f) => <option key={f.key} value={f.key} className="bg-[#111725]">{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Bo'lim</label>
            <select className="field" value={category} onChange={(e) => { setCategory(e.target.value); setCurrentPage(1); }}>
              <option value="" className="bg-[#111725]">Barchasi</option>
              {CATEGORIES.map((c) => <option key={c.key} value={c.key} className="bg-[#111725]">{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Valyuta</label>
            <select className="field" value={currency} onChange={(e) => { setCurrency(e.target.value); setCurrentPage(1); }}>
              <option value="" className="bg-[#111725]">Barchasi</option>
              {CURRENCIES.map((c) => <option key={c} value={c} className="bg-[#111725]">{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Saralash</label>
            <select className="field" value={sort} onChange={(e) => { setSort(e.target.value); setCurrentPage(1); }}>
              {SORTS.map((s) => <option key={s.key} value={s.key} className="bg-[#111725]">{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading && !rows.length ? (
        <Loading label="Hisoblar yuklanmoqda..." />
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <Icon name="search" size={32} className="mx-auto mb-3 text-white/30" />
          <p className="text-white/60">Hisob topilmadi</p>
        </div>
      ) : (
        <>
          <div className="card hidden overflow-hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-white/45">
                    <th className="px-4 py-3 font-semibold">Nomi</th>
                    <th className="px-4 py-3 font-semibold">Bo'lim</th>
                    <th className="px-4 py-3 font-semibold">Yetkazib beruvchi</th>
                    <th className="px-4 py-3 text-right font-semibold">Summa</th>
                    <th className="px-4 py-3 text-right font-semibold">To'langan</th>
                    <th className="px-4 py-3 text-right font-semibold">Qolgan</th>
                    <th className="px-4 py-3 font-semibold">Holat</th>
                    <th className="px-4 py-3 font-semibold">Muddat</th>
                    <th className="px-4 py-3 font-semibold">Amal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const meta = STATUS_META[e.status] || STATUS_META.unpaid;
                    const archived = Boolean(e.deleted_at);
                    return (
                      <tr key={e.id} className={`border-b border-white/5 transition hover:bg-white/[0.03] ${meta.row} ${archived ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-white">{e.item_name}</div>
                          {e.description && <div className="text-xs text-white/40">{e.description}</div>}
                        </td>
                        <td className="px-4 py-3 text-white/70">{e.category_label || categoryLabel(e.category)}</td>
                        <td className="px-4 py-3 text-white/70">
                          <div>{e.supplier || '—'}</div>
                          {e.phone && <div className="text-xs text-white/40">{e.phone}</div>}
                        </td>
                        <td className="px-4 py-3 text-right text-white/80">{money(e.total_amount, e.currency)}</td>
                        <td className="px-4 py-3 text-right text-emerald-300/90">{money(e.paid_amount, e.currency)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-300">{money(e.remaining_amount, e.currency)}</td>
                        <td className="px-4 py-3">
                          <Badge kind={archived ? 'default' : meta.badge}>{archived ? 'Arxiv' : (e.status_label || meta.label)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-white/45">{e.due_date || '—'}</td>
                        <td className="px-4 py-3">
                          <RowActions
                            expense={e}
                            archived={archived}
                            onPay={() => setPayFor(e)}
                            onMarkPaid={async () => { try { await api.post(`/admin/expenses/${e.id}/mark-paid`); setNotice("Hisob to'liq to'langan deb belgilandi."); await load(); } catch (err) { setError(err.message); } }}
                            onEdit={() => setEditFor(e)}
                            onHistory={() => setHistoryFor(e)}
                            onDelete={() => setDeleteTarget(e)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 lg:hidden">
            {rows.map((e) => {
              const meta = STATUS_META[e.status] || STATUS_META.unpaid;
              const archived = Boolean(e.deleted_at);
              return (
                <div key={e.id} className={`card p-4 ${archived ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold">{e.item_name}</div>
                      <div className="text-xs text-white/45">{e.category_label || categoryLabel(e.category)} · {e.supplier || '—'}</div>
                      {e.phone && <div className="text-xs text-white/40">{e.phone}</div>}
                    </div>
                    <Badge kind={archived ? 'default' : meta.badge}>{archived ? 'Arxiv' : (e.status_label || meta.label)}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-[10px] uppercase text-white/40">Summa</div><div className="text-xs font-semibold">{money(e.total_amount, e.currency)}</div></div>
                    <div><div className="text-[10px] uppercase text-white/40">To'langan</div><div className="text-xs font-semibold text-emerald-300">{money(e.paid_amount, e.currency)}</div></div>
                    <div><div className="text-[10px] uppercase text-white/40">Qolgan</div><div className="text-xs font-bold text-red-300">{money(e.remaining_amount, e.currency)}</div></div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
                    <RowActions
                      expense={e}
                      archived={archived}
                      onPay={() => setPayFor(e)}
                      onMarkPaid={async () => { try { await api.post(`/admin/expenses/${e.id}/mark-paid`); setNotice("Hisob to'liq to'langan deb belgilandi."); await load(); } catch (err) { setError(err.message); } }}
                      onEdit={() => setEditFor(e)}
                      onHistory={() => setHistoryFor(e)}
                      onDelete={() => setDeleteTarget(e)}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {page.pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/45">
                {page.total} ta yozuv · {page.page} / {page.pages} sahifa
              </span>
              <div className="flex gap-2">
                <button type="button" className="btn-outline !py-2 text-sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(currentPage - 1)}>Oldingi</button>
                <button type="button" className="btn-outline !py-2 text-sm" disabled={currentPage >= page.pages} onClick={() => setCurrentPage(currentPage + 1)}>Keyingi</button>
              </div>
            </div>
          )}
        </>
      )}

      <AddExpenseModal masters={masters} open={addOpen} onClose={() => setAddOpen(false)} onSaved={async () => { setAddOpen(false); setNotice("Hisob qo'shildi"); await load(); }} />
      <EditExpenseModal masters={masters} expense={editFor} onClose={() => setEditFor(null)} onSaved={async () => { setEditFor(null); setNotice("Hisob yangilandi."); await load(); }} />
      <PaymentModal expense={payFor} onClose={() => setPayFor(null)} onSaved={load} />
      <HistoryModal expense={historyFor} onClose={() => setHistoryFor(null)} onChanged={load} />
      <DeleteModal expense={deleteTarget} onClose={() => setDeleteTarget(null)} onDone={onDeleted} />
    </div>
  );
}

function RowActions({ expense, archived, onPay, onMarkPaid, onEdit, onHistory, onDelete }) {
  const unpaid = Number(expense.remaining_amount) > 0;
  return (
    <div className="flex items-center gap-1.5">
      {!archived && unpaid && (
        <button type="button" onClick={onPay} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20">
          <Icon name="money" size={14} /> To'lov
        </button>
      )}
      {!archived && unpaid && (
        <button type="button" onClick={onMarkPaid} className="rounded-lg border border-white/10 p-1.5 text-white/60 transition hover:bg-white/10" title="To'liq to'langan deb belgilash">
          <Icon name="check" size={14} />
        </button>
      )}
      {!archived && (
        <button type="button" onClick={onEdit} className="rounded-lg border border-white/10 p-1.5 text-white/60 transition hover:bg-white/10" title="Tahrirlash">
          <Icon name="edit" size={14} />
        </button>
      )}
      <button type="button" onClick={onHistory} className="rounded-lg border border-white/10 p-1.5 text-white/60 transition hover:bg-white/10" title="Tarix">
        <Icon name="document" size={14} />
      </button>
      {!archived && (
        <button type="button" onClick={onDelete} className="rounded-lg border border-red-500/30 p-1.5 text-red-300 transition hover:bg-red-500/20" title="Arxivlash">
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  );
}

/** Authenticated CSV download of the rows currently in view. */
function CsvButton({ params, onError }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    if (onError) onError('');
    try {
      const res = await fetch(`/api/admin/expenses/export.csv?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('CSV faylini yaratishda xatolik yuz berdi.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `moy-hisob-kitob-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (onError) onError(e.message || 'CSV faylini yaratishda xatolik yuz berdi.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={download} disabled={busy} className="btn-outline flex items-center gap-2 !py-2.5 text-sm">
      <Icon name="document" size={16} /> {busy ? 'Tayyorlanmoqda...' : 'CSV eksport'}
    </button>
  );
}

const EMPTY = {
  item_name: '', description: '', supplier: '', phone: '', category: 'oil',
  quantity: '1', unit: 'dona', unit_price: '', total_amount: '', paid_amount: '',
  currency: DEFAULT_CURRENCY, due_date: '', master_id: '',
};

function MasterSelect({ value, onChange, masters, disabled }) {
  return (
    <select className="field" value={value} onChange={onChange} disabled={disabled}>
      <option value="" className="bg-[#111725]">— Usta tanlanmagan —</option>
      {masters.map((m) => <option key={m.id} value={m.id} className="bg-[#111725]">{m.full_name || m.username}</option>)}
    </select>
  );
}

function AddExpenseModal({ open, onClose, onSaved, masters }) {
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setForm(EMPTY); setMsg(null); }
  }, [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await api.post('/admin/expenses', {
        ...form,
        unit_price: form.unit_price.replace(/\s/g, ''),
        total_amount: form.total_amount.replace(/\s/g, ''),
        paid_amount: form.paid_amount.replace(/\s/g, ''),
      });
      await onSaved();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Hisob qo'shish" wide>
      <form onSubmit={onSubmit} className="space-y-4">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Nomi *</label>
            <input className="field" value={form.item_name} onChange={set('item_name')} required />
          </div>
          <div>
            <label className="label">Bo'lim</label>
            <select className="field" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c.key} value={c.key} className="bg-[#111725]">{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Valyuta</label>
            <CurrencySelect value={form.currency} onChange={set('currency')} />
          </div>
          <div>
            <label className="label">Yetkazib beruvchi</label>
            <input className="field" value={form.supplier} onChange={set('supplier')} />
          </div>
          <div>
            <label className="label">Telefon</label>
            <input className="field" value={form.phone} onChange={set('phone')} placeholder="+998 90 123 45 67" />
          </div>
          <div>
            <label className="label">Miqdor</label>
            <input className="field" inputMode="decimal" value={form.quantity} onChange={set('quantity')} />
          </div>
          <div>
            <label className="label">O'lchov birligi</label>
            <input className="field" value={form.unit} onChange={set('unit')} placeholder="dona / litr" />
          </div>
          <div>
            <label className="label">Birlik narxi</label>
            <input className="field" inputMode="numeric" value={form.unit_price} onChange={set('unit_price')} placeholder="0" />
          </div>
          <div>
            <label className="label">Umumiy summa *</label>
            <input className="field" inputMode="numeric" value={form.total_amount} onChange={set('total_amount')} placeholder="bo'sh qoldirilsa hisoblanadi" />
          </div>
          <div>
            <label className="label">To'langan summa</label>
            <input className="field" inputMode="numeric" value={form.paid_amount} onChange={set('paid_amount')} placeholder="0" />
          </div>
          <div>
            <label className="label">To'lov muddati</label>
            <input type="date" className="field" value={form.due_date} onChange={set('due_date')} />
          </div>
          <div>
            <label className="label">Mas'ul usta</label>
            <MasterSelect value={form.master_id} onChange={set('master_id')} masters={masters} />
          </div>
        </div>
        <div>
          <label className="label">Izoh</label>
          <textarea className="field min-h-[80px]" value={form.description} onChange={set('description')} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={busy} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{busy ? 'Saqlanmoqda...' : 'Saqlash'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditExpenseModal({ expense, onClose, onSaved, masters }) {
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!expense) { setForm(null); return; }
    setForm({
      item_name: expense.item_name || '',
      description: expense.description || '',
      supplier: expense.supplier || '',
      phone: expense.phone || '',
      category: expense.category || 'other',
      quantity: String(expense.quantity == null ? '1' : expense.quantity),
      unit: expense.unit || 'dona',
      unit_price: String(expense.unit_price == null ? '' : expense.unit_price),
      total_amount: String(expense.total_amount == null ? '' : expense.total_amount),
      currency: expense.currency || DEFAULT_CURRENCY,
      due_date: (expense.due_date || '').slice(0, 10),
      master_id: expense.master_id == null ? '' : String(expense.master_id),
    });
    setMsg(null);
    setBusy(false);
  }, [expense]);

  if (!expense || !form) return null;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const lockedCurrency = Number(expense.paid_amount) > 0;

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setMsg(null);
    setBusy(true);
    try {
      await api.patch(`/admin/expenses/${expense.id}`, {
        item_name: form.item_name,
        description: form.description,
        supplier: form.supplier,
        phone: form.phone,
        category: form.category,
        quantity: form.quantity,
        unit: form.unit,
        unit_price: form.unit_price.replace(/\s/g, ''),
        total_amount: form.total_amount.replace(/\s/g, ''),
        currency: form.currency,
        due_date: form.due_date,
        master_id: form.master_id,
      });
      await onSaved();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Hisobni tahrirlash" wide>
      <form onSubmit={onSubmit} className="space-y-4">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Nomi *</label>
            <input className="field" value={form.item_name} onChange={set('item_name')} required disabled={busy} />
          </div>
          <div>
            <label className="label">Bo'lim</label>
            <select className="field" value={form.category} onChange={set('category')} disabled={busy}>
              {CATEGORIES.map((c) => <option key={c.key} value={c.key} className="bg-[#111725]">{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Valyuta</label>
            <CurrencySelect value={form.currency} onChange={set('currency')} disabled={busy || lockedCurrency} />
            {lockedCurrency && <p className="mt-1 text-xs text-white/40">To'lov qilingan, valyutani o'zgartirib bo'lmaydi.</p>}
          </div>
          <div>
            <label className="label">Yetkazib beruvchi</label>
            <input className="field" value={form.supplier} onChange={set('supplier')} disabled={busy} />
          </div>
          <div>
            <label className="label">Telefon</label>
            <input className="field" value={form.phone} onChange={set('phone')} disabled={busy} />
          </div>
          <div>
            <label className="label">Miqdor</label>
            <input className="field" inputMode="decimal" value={form.quantity} onChange={set('quantity')} disabled={busy} />
          </div>
          <div>
            <label className="label">O'lchov birligi</label>
            <input className="field" value={form.unit} onChange={set('unit')} disabled={busy} />
          </div>
          <div>
            <label className="label">Birlik narxi</label>
            <input className="field" inputMode="numeric" value={form.unit_price} onChange={set('unit_price')} disabled={busy} />
          </div>
          <div>
            <label className="label">Umumiy summa *</label>
            <input className="field" inputMode="numeric" value={form.total_amount} onChange={set('total_amount')} required disabled={busy} />
          </div>
          <div>
            <label className="label">To'lov muddati</label>
            <input type="date" className="field" value={form.due_date} onChange={set('due_date')} disabled={busy} />
          </div>
          <div>
            <label className="label">Mas'ul usta</label>
            <MasterSelect value={form.master_id} onChange={set('master_id')} masters={masters} disabled={busy} />
          </div>
        </div>
        <div>
          <label className="label">Izoh</label>
          <textarea className="field min-h-[80px]" value={form.description} onChange={set('description')} disabled={busy} />
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/55">
          To'langan {money(expense.paid_amount, expense.currency)} · qolgan {money(expense.remaining_amount, expense.currency)}. To'lovni faqat "To'lov" orqali o'zgartirasiz.
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={busy} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{busy ? 'Saqlanmoqda...' : 'Saqlash'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({ expense, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (expense) { setAmount(''); setNote(''); setMsg(null); }
  }, [expense]);

  if (!expense) return null;

  async function onSubmit(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await api.post(`/admin/expenses/${expense.id}/payments`, { amount: amount.replace(/\s/g, ''), note });
      onClose();
      if (onSaved) await onSaved();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="To'lov qo'shish">
      <form onSubmit={onSubmit} className="space-y-4">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
          <div className="flex justify-between"><span className="text-white/50">Summa</span><span className="font-semibold">{money(expense.total_amount, expense.currency)}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-white/50">To'langan</span><span className="font-semibold text-emerald-300">{money(expense.paid_amount, expense.currency)}</span></div>
          <div className="mt-1 flex justify-between border-t border-white/10 pt-1"><span className="text-white/50">Qolgan</span><span className="font-bold text-red-300">{money(expense.remaining_amount, expense.currency)}</span></div>
        </div>
        <div>
          <label className="label">To'lov summasi ({symbolOf(expense.currency)}) *</label>
          <input className="field" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="200000" required />
        </div>
        <div>
          <label className="label">Izoh</label>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={busy} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{busy ? 'Saqlanmoqda...' : "To'lovni qo'shish"}</button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({ expense, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [voidFor, setVoidFor] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const reload = useCallback(() => {
    if (!expense) return;
    setData(null);
    api.get(`/admin/expenses/${expense.id}`).then(setData).catch(() => setData({ error: 'Tarixni yuklab bo\'lmadi' }));
  }, [expense]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!expense) return null;

  async function doVoid(paymentId) {
    setMsg(null);
    setBusy(true);
    try {
      await api.post(`/admin/expenses/${expense.id}/payments/${paymentId}/void`, { reason });
      setVoidFor(null);
      setReason('');
      reload();
      if (onChanged) await onChanged();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${expense.item_name} — tarix`} wide>
      <div className="space-y-5">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/50">To'lovlar</h3>
          {!data ? <Loading /> : data.error ? <Alert>{data.error}</Alert> : data.payments.length === 0 ? (
            <p className="text-sm text-white/45">To'lovlar yo'q</p>
          ) : (
            <div className="space-y-2">
              {data.payments.map((p) => (
                <div key={p.id} className={`rounded-xl border px-4 py-3 text-sm ${p.voided_at ? 'border-white/10 bg-white/[0.02] opacity-60' : 'border-white/10 bg-white/[0.02]'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`font-semibold ${p.voided_at ? 'text-white/50 line-through' : 'text-emerald-300'}`}>{money(p.amount, p.currency)}</div>
                      {p.note && <div className="text-xs text-white/45">{p.note}</div>}
                      {p.voided_at && <div className="text-xs text-red-300/80">Bekor qilingan: {p.void_reason}</div>}
                    </div>
                    <div className="text-right text-xs text-white/40">
                      <div>{p.created_at}</div>
                      <div>{p.created_by_name || '—'}</div>
                      {!p.voided_at && (
                        <button type="button" onClick={() => { setVoidFor(voidFor === p.id ? null : p.id); setReason(''); }} className="mt-1 text-red-300 underline">
                          Bekor qilish
                        </button>
                      )}
                    </div>
                  </div>
                  {voidFor === p.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-white/10 pt-3">
                      <div className="min-w-[200px] flex-1">
                        <label className="label">Sabab *</label>
                        <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Xato kiritilgan" />
                      </div>
                      <button type="button" disabled={busy || !reason.trim()} onClick={() => doVoid(p.id)} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60">
                        {busy ? 'Jarayonda...' : 'Bekor qilish'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/50">Audit log</h3>
          {!data || data.error ? null : data.audit_logs.length === 0 ? (
            <p className="text-sm text-white/45">Audit yozuvlari yo'q</p>
          ) : (
            <div className="space-y-1.5">
              {data.audit_logs.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 text-xs">
                  <span className="font-medium text-white/70">{a.action}</span>
                  <span className="text-white/40">{a.created_at} · {a.admin_name || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function DeleteModal({ expense, onClose, onDone }) {
  const [stage, setStage] = useState('confirm');
  const [passKey, setPassKey] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (expense) { setStage('confirm'); setPassKey(''); setMsg(null); }
  }, [expense]);

  if (!expense) return null;

  const unpaid = Number(expense.remaining_amount) > 0;
  if (unpaid) {
    return (
      <Modal open onClose={onClose} title="Arxivlash">
        <p className="text-sm text-white/70">Bu hisob hali to'liq to'lanmagan.</p>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Yopish</button>
        </div>
      </Modal>
    );
  }

  async function onDelete() {
    setMsg(null);
    setBusy(true);
    try {
      await api.delWithHeaders(`/admin/expenses/${expense.id}`, { 'X-Debt-Pass-Key': passKey });
      setPassKey('');
      await onDone();
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Hisobni arxivlash">
      {stage === 'confirm' ? (
        <>
          <p className="text-sm text-white/70">Bu hisobni arxivlashni xohlaysizmi?</p>
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
            <span className="font-semibold">{expense.item_name}</span>
            <span className="ml-2 text-white/45">{money(expense.total_amount, expense.currency)} · to'langan {money(expense.paid_amount, expense.currency)}</span>
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
            <button type="button" onClick={() => setStage('passkey')} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500">Davom etish</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-white/70">Arxivlashni tasdiqlash uchun pass key kiriting.</p>
          {msg && <div className="mt-3"><Alert kind="error">{msg.text}</Alert></div>}
          <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); onDelete(); }}>
            <div>
              <label className="label">Pass key</label>
              <input className="field" type="password" value={passKey} onChange={(e) => setPassKey(e.target.value)} autoComplete="off" required />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setStage('confirm')} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Orqaga</button>
              <button type="submit" disabled={busy || !passKey} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60">
                {busy ? 'Jarayonda...' : "Hisobni arxivlash"}
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}
