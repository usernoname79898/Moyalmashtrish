import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAdmin } from '../../store';
import Icon from '../../components/icons';
import { Loading, Alert, Badge, Modal, ConfirmDialog, EmptyState } from '../../components/ui';
import { money } from '../../money';

function title(v) {
  return [v.brand, v.model].filter(Boolean).join(' ') || 'Avtomobil';
}

function formatDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

export default function VehiclesPage() {
  const { user } = useAdmin();
  const isSA = user.role === 'super_admin';
  const [vehicles, setVehicles] = useState(null);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
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
      if (customerId) params.set('customer_id', customerId);
      if (archived) params.set('archived', '1');
      const [list, summary] = await Promise.all([
        api.get('/admin/vehicles?' + params.toString()),
        api.get('/admin/vehicles/stats'),
      ]);
      setVehicles(list.vehicles || []);
      setPagination(list.pagination || null);
      setStats(summary.stats || null);
    } catch (err) {
      setError(err.message);
      setVehicles([]);
    }
  }, [page, search, customerId, archived]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/admin/customers?per_page=100').then((data) => setCustomers(data.customers || [])).catch(() => {});
  }, []);
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
      await api.del('/admin/vehicles/' + archiving.id);
      setArchiving(null);
      setNotice('Avtomobil arxivlandi');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function restore(vehicle) {
    try {
      await api.post(`/admin/vehicles/${vehicle.id}/restore`);
      setNotice('Avtomobil tiklandi');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function openDetail(vehicle) {
    try {
      setDetail(await api.get('/admin/vehicles/' + vehicle.id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Avtomobillar</h1>
          <p className="mt-1 text-sm text-white/50">Mijoz avtomobillari va xizmat tarixi.</p>
        </div>
        <button type="button" onClick={() => setEditing({})} className="btn-primary !py-2.5 text-sm">
          <Icon name="pluss" size={16} /> Yangi avtomobil
        </button>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Stat icon="car" label="Faol avtomobil" value={stats.total} />
          <Stat icon="user" label="Mijozsiz" value={stats.without_customer} />
          <Stat icon="box" label="Arxiv" value={stats.archived} />
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 !p-4">
        <div className="min-w-[220px] flex-1">
          <label className="label">Qidirish</label>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Marka, model, raqam, VIN yoki mijoz..." />
        </div>
        <div className="min-w-[180px]">
          <label className="label">Mijoz</label>
          <select className="field" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setPage(1); }}>
            <option value="">Barchasi</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
          </select>
        </div>
        <div className="flex rounded-xl border border-white/10 p-1">
          <button type="button" onClick={() => { setArchived(false); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${!archived ? 'bg-white/10 text-white' : 'text-white/45'}`}>Faol</button>
          <button type="button" onClick={() => { setArchived(true); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${archived ? 'bg-white/10 text-white' : 'text-white/45'}`}>Arxiv</button>
        </div>
      </div>

      {!vehicles ? (
        <Loading label="Avtomobillar yuklanmoqda..." />
      ) : vehicles.length === 0 ? (
        <div className="card"><EmptyState icon="car" title="Avtomobil topilmadi" hint="Yangi avtomobil qo'shing yoki qidiruvni o'zgartiring." /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className="card !p-4">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => openDetail(vehicle)} className="min-w-0 text-left">
                  <div className="truncate font-bold">{title(vehicle)}</div>
                  <div className="mt-0.5 text-xs text-white/45">{vehicle.plate_number || vehicle.vin || `#${vehicle.id}`}</div>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => setEditing(vehicle)} className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white" title="Tahrirlash"><Icon name="edit" size={16} /></button>
                  {isSA && <button type="button" onClick={() => (archived ? restore(vehicle) : setArchiving(vehicle))} className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white" title={archived ? 'Tiklash' : 'Arxivlash'}><Icon name={archived ? 'refresh' : 'trash'} size={16} /></button>}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white/[0.03] p-2"><div className="text-white/40">Mijoz</div><div className="mt-0.5 truncate text-white/75">{vehicle.customer_name || 'Biriktirilmagan'}</div></div>
                <div className="rounded-lg bg-white/[0.03] p-2"><div className="text-white/40">Yil / rang</div><div className="mt-0.5 truncate text-white/75">{[vehicle.year, vehicle.color].filter(Boolean).join(' · ') || '—'}</div></div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-white/40">
                <span>{vehicle.work_count} ta ish</span>
                <span>Oxirgi: {formatDate(vehicle.last_visit)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-white/50">
          <span>{pagination.total} ta avtomobil</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40">Oldingi</button>
            <span>{pagination.page} / {pagination.pages}</span>
            <button type="button" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40">Keyingi</button>
          </div>
        </div>
      )}

      {editing && <VehicleForm initial={editing} customers={customers} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice('Avtomobil saqlandi'); await load(); }} />}
      {detail && <VehicleDetail data={detail} onClose={() => setDetail(null)} />}
      <ConfirmDialog
        open={!!archiving}
        title="Avtomobilni arxivlash"
        message={`${archiving ? title(archiving) : ''} arxivlanadi. Xizmat tarixi saqlanadi.`}
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

function VehicleForm({ initial, customers, onClose, onSaved }) {
  const [form, setForm] = useState({
    customer_id: initial.customer_id || '',
    brand: initial.brand || '',
    model: initial.model || '',
    year: initial.year || '',
    plate_number: initial.plate_number || '',
    vin: initial.vin || '',
    color: initial.color || '',
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
      const payload = { ...form, year: form.year === '' ? null : form.year };
      if (initial.id) await api.put('/admin/vehicles/' + initial.id, payload);
      else await api.post('/admin/vehicles', payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Avtomobilni tahrirlash' : 'Yangi avtomobil'}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label">Mijoz</label>
          <select className="field" value={form.customer_id} onChange={set('customer_id')}>
            <option value="">Biriktirilmagan</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}{customer.phone ? ` · ${customer.phone}` : ''}</option>)}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Marka</label><input className="field" value={form.brand} onChange={set('brand')} placeholder="Chevrolet" /></div>
          <div><label className="label">Model</label><input className="field" value={form.model} onChange={set('model')} placeholder="Cobalt" /></div>
          <div><label className="label">Davlat raqami</label><input className="field uppercase" value={form.plate_number} onChange={set('plate_number')} placeholder="01 A 123 AA" /></div>
          <div><label className="label">Yil</label><input type="number" min="1886" max="2200" className="field" value={form.year} onChange={set('year')} placeholder="2022" /></div>
          <div><label className="label">VIN</label><input className="field uppercase" value={form.vin} onChange={set('vin')} /></div>
          <div><label className="label">Rang</label><input className="field" value={form.color} onChange={set('color')} placeholder="Oq" /></div>
        </div>
        <div><label className="label">Izoh</label><textarea className="field min-h-[70px]" value={form.notes} onChange={set('notes')} /></div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={saving} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{saving ? 'Saqlanmoqda...' : 'Saqlash'}</button>
        </div>
      </form>
    </Modal>
  );
}

function VehicleDetail({ data, onClose }) {
  const vehicle = data.vehicle;
  return (
    <Modal open onClose={onClose} title={title(vehicle)} wide footer={<div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Yopish</button></div>}>
      <div className="space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Info label="Davlat raqami" value={vehicle.plate_number} />
          <Info label="VIN" value={vehicle.vin} />
          <Info label="Yil" value={vehicle.year} />
          <Info label="Mijoz" value={vehicle.customer_name} />
          <Info label="Telefon" value={vehicle.customer_phone} />
          <Info label="Rang" value={vehicle.color} />
        </div>
        {vehicle.notes && <div className="rounded-xl bg-white/[0.03] p-3 text-sm text-white/65">{vehicle.notes}</div>}

        <section>
          <h4 className="mb-2 text-sm font-bold">Xizmat tarixi ({data.worklogs.length})</h4>
          {data.worklogs.length === 0 ? <p className="text-sm text-white/40">Xizmat tarixi yo'q</p> : (
            <div className="space-y-2">
              {data.worklogs.slice(0, 10).map((work) => (
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

function Info({ label, value }) {
  return <div className="rounded-xl bg-white/[0.03] p-3"><div className="text-xs text-white/40">{label}</div><div className="mt-1">{value || '—'}</div></div>;
}
