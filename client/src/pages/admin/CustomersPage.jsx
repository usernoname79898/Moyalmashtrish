import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAdmin } from '../../store';
import Icon from '../../components/icons';
import { Loading, Alert, Badge, Modal, ConfirmDialog, EmptyState } from '../../components/ui';
import { money } from '../../money';

function formatDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

export default function CustomersPage() {
  const { user } = useAdmin();
  const isSA = user.role === 'super_admin';
  const [customers, setCustomers] = useState(null);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '20' });
      if (search) params.set('q', search);
      if (archived) params.set('archived', '1');
      const [list, summary] = await Promise.all([
        api.get('/admin/customers?' + params.toString()),
        api.get('/admin/customers/stats'),
      ]);
      setCustomers(list.customers || []);
      setPagination(list.pagination || null);
      setStats(summary.stats || null);
    } catch (err) {
      setError(err.message);
      setCustomers([]);
    }
  }, [page, search, archived]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  async function archive() {
    setBusy(true);
    try {
      await api.del('/admin/customers/' + archiving.id);
      setArchiving(null);
      setNotice('Mijoz arxivlandi');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function restore(customer) {
    try {
      await api.post(`/admin/customers/${customer.id}/restore`);
      setNotice('Mijoz tiklandi');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openDetail(customer) {
    try {
      const data = await api.get('/admin/customers/' + customer.id);
      setDetail(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Mijozlar</h1>
          <p className="mt-1 text-sm text-white/50">Mijoz kartalari, avtomobillari va xizmat tarixi.</p>
        </div>
        <button type="button" onClick={() => setEditing({})} className="btn-primary !py-2.5 text-sm">
          <Icon name="pluss" size={16} /> Yangi mijoz
        </button>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon="user" label="Faol mijozlar" value={stats.total} />
          <Stat icon="car" label="Avtomobillar" value={stats.vehicles} />
          <Stat icon="spark" label="Bu oy qo'shildi" value={stats.new_this_month} />
          <Stat icon="box" label="Arxiv" value={stats.archived} />
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 !p-4">
        <div className="min-w-[240px] flex-1">
          <label className="label">Qidirish</label>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism, telefon, raqam, VIN yoki email..." />
        </div>
        <div className="flex rounded-xl border border-white/10 p-1">
          <button type="button" onClick={() => { setArchived(false); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${!archived ? 'bg-white/10 text-white' : 'text-white/45'}`}>Faol</button>
          <button type="button" onClick={() => { setArchived(true); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${archived ? 'bg-white/10 text-white' : 'text-white/45'}`}>Arxiv</button>
        </div>
      </div>

      {!customers ? (
        <Loading label="Mijozlar yuklanmoqda..." />
      ) : customers.length === 0 ? (
        <div className="card"><EmptyState icon="user" title="Mijoz topilmadi" hint="Yangi mijoz qo'shing yoki qidiruvni o'zgartiring." /></div>
      ) : (
        <>
          <div className="card hidden overflow-hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/45">
                    <th className="px-4 py-3">Mijoz</th>
                    <th className="px-4 py-3">Telefon</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3 text-center">Avtomobil</th>
                    <th className="px-4 py-3 text-center">Ishlar</th>
                    <th className="px-4 py-3">Oxirgi tashrif</th>
                    <th className="px-4 py-3 text-right">Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => openDetail(customer)} className="text-left font-semibold text-white hover:text-[rgb(var(--c-primary))]">{customer.full_name}</button>
                        <div className="text-xs text-white/40">{customer.address || `#${customer.id}`}</div>
                      </td>
                      <td className="px-4 py-3 text-white/65">{customer.phone || '—'}</td>
                      <td className="px-4 py-3 text-white/55">{customer.email || '—'}</td>
                      <td className="px-4 py-3 text-center">{customer.vehicle_count}</td>
                      <td className="px-4 py-3 text-center">{customer.work_count}</td>
                      <td className="px-4 py-3 text-xs text-white/50">{formatDate(customer.last_visit)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => openDetail(customer)} className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white" title="Ko'rish"><Icon name="eye" size={16} /></button>
                          <button type="button" onClick={() => setEditing(customer)} className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white" title="Tahrirlash"><Icon name="edit" size={16} /></button>
                          {isSA && !archived && <button type="button" onClick={() => setArchiving(customer)} className="rounded-lg p-2 text-white/45 hover:bg-red-500/10 hover:text-red-300" title="Arxivlash"><Icon name="trash" size={16} /></button>}
                          {isSA && archived && <button type="button" onClick={() => restore(customer)} className="rounded-lg p-2 text-white/45 hover:bg-emerald-500/10 hover:text-emerald-300" title="Tiklash"><Icon name="refresh" size={16} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 lg:hidden">
            {customers.map((customer) => (
              <div key={customer.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button type="button" onClick={() => openDetail(customer)} className="text-left font-bold">{customer.full_name}</button>
                    <div className="mt-0.5 text-xs text-white/50">{customer.phone || 'Telefon yo\'q'}</div>
                    <div className="mt-1 text-xs text-white/40">{customer.vehicle_count} avtomobil · {customer.work_count} ish</div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setEditing(customer)} className="rounded-lg p-2 text-white/45 hover:bg-white/10"><Icon name="edit" size={16} /></button>
                    {isSA && <button type="button" onClick={() => (archived ? restore(customer) : setArchiving(customer))} className="rounded-lg p-2 text-white/45 hover:bg-white/10"><Icon name={archived ? 'refresh' : 'trash'} size={16} /></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-white/50">
          <span>{pagination.total} ta mijoz</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40">Oldingi</button>
            <span>{pagination.page} / {pagination.pages}</span>
            <button type="button" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40">Keyingi</button>
          </div>
        </div>
      )}

      {editing && <CustomerForm initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice('Mijoz saqlandi'); await load(); }} />}
      {detail && <CustomerDetail data={detail} onClose={() => setDetail(null)} />}
      <ConfirmDialog
        open={!!archiving}
        title="Mijozni arxivlash"
        message={`${archiving?.full_name} arxivlanadi. Tarix va ishlar saqlanadi.`}
        onCancel={() => setArchiving(null)}
        onConfirm={archive}
        busy={busy}
        confirmLabel="Arxivlash"
      />
    </div>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white/60"><Icon name={icon} size={18} /></span>
      <div><div className="text-xl font-extrabold leading-none">{value ?? '—'}</div><div className="mt-1 text-xs text-white/45">{label}</div></div>
    </div>
  );
}

function CustomerForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    full_name: initial.full_name || '',
    phone: initial.phone || '',
    email: initial.email || '',
    address: initial.address || '',
    notes: initial.notes || '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (initial.id) await api.put('/admin/customers/' + initial.id, form);
      else await api.post('/admin/customers', form);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Mijozni tahrirlash' : 'Yangi mijoz'}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label">To'liq ism *</label>
          <input className="field" value={form.full_name} onChange={set('full_name')} required placeholder="Ali Valiyev" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Telefon</label>
            <input className="field" value={form.phone} onChange={set('phone')} placeholder="+998 90 000 00 00" />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="field" value={form.email} onChange={set('email')} placeholder="ali@example.com" />
          </div>
        </div>
        <div>
          <label className="label">Manzil</label>
          <input className="field" value={form.address} onChange={set('address')} placeholder="Toshkent, ..." />
        </div>
        <div>
          <label className="label">Izoh</label>
          <textarea className="field min-h-[80px]" value={form.notes} onChange={set('notes')} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={saving} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{saving ? 'Saqlanmoqda...' : 'Saqlash'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CustomerDetail({ data, onClose }) {
  const customer = data.customer;
  return (
    <Modal open onClose={onClose} title={customer.full_name} wide footer={<div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Yopish</button></div>}>
      <div className="space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-xs text-white/40">Telefon</div><div className="mt-1">{customer.phone || '—'}</div></div>
          <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-xs text-white/40">Email</div><div className="mt-1">{customer.email || '—'}</div></div>
          <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-xs text-white/40">Manzil</div><div className="mt-1">{customer.address || '—'}</div></div>
          <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-xs text-white/40">Qo'shilgan</div><div className="mt-1">{formatDate(customer.created_at)}</div></div>
        </div>
        {customer.notes && <div className="rounded-xl bg-white/[0.03] p-3 text-sm text-white/65">{customer.notes}</div>}

        <section>
          <h4 className="mb-2 text-sm font-bold">Avtomobillar ({data.vehicles.length})</h4>
          {data.vehicles.length === 0 ? <p className="text-sm text-white/40">Avtomobil yo'q</p> : (
            <div className="space-y-2">
              {data.vehicles.map((vehicle) => (
                <div key={vehicle.id} className="flex items-center justify-between rounded-xl border border-white/5 px-3 py-2 text-sm">
                  <span>{[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Avtomobil'} {vehicle.plate_number && <span className="text-white/45">· {vehicle.plate_number}</span>}</span>
                  {!vehicle.is_active && <Badge>Arxiv</Badge>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-sm font-bold">Ishlar ({data.worklogs.length})</h4>
          {data.worklogs.length === 0 ? <p className="text-sm text-white/40">Ish tarixi yo'q</p> : (
            <div className="space-y-2">
              {data.worklogs.slice(0, 8).map((work) => (
                <div key={work.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 px-3 py-2 text-sm">
                  <div className="min-w-0"><div className="truncate">{work.title}</div><div className="text-xs text-white/40">{work.service_type} · {formatDate(work.created_at)}</div></div>
                  <div className="shrink-0 text-right"><Badge kind={work.status === 'Tugallangan' ? 'success' : 'default'}>{work.status}</Badge><div className="mt-1 text-xs text-white/55">{money(work.price, work.currency)}</div></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-sm font-bold">Navbatlar ({data.appointments.length})</h4>
          {data.appointments.length === 0 ? <p className="text-sm text-white/40">Navbat yo'q</p> : (
            <div className="space-y-2">
              {data.appointments.slice(0, 6).map((appointment) => (
                <div key={appointment.id} className="flex items-center justify-between rounded-xl border border-white/5 px-3 py-2 text-sm">
                  <span>{appointment.scheduled_date} · {appointment.scheduled_time} · {appointment.service_type}</span>
                  <Badge>{appointment.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
