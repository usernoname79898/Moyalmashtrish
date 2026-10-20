import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAdmin } from '../../store';
import Icon from '../../components/icons';
import { Loading, Alert, Badge, Modal, ConfirmDialog, EmptyState, Spinner } from '../../components/ui';
import { useServiceTypes } from '../../serviceTypes';

const STATUSES = ['Kutilayotgan', 'Tasdiqlangan', 'Jarayonda', 'Tugallangan', 'Bekor qilingan'];
const STATUS_STYLE = {
  Kutilayotgan: 'warn',
  Tasdiqlangan: 'primary',
  Jarayonda: 'warn',
  Tugallangan: 'success',
  'Bekor qilingan': 'danger',
};
const NEXT_STATUS = {
  Kutilayotgan: ['Tasdiqlangan', 'Bekor qilingan'],
  Tasdiqlangan: ['Jarayonda', 'Bekor qilingan'],
  Jarayonda: ['Tugallangan', 'Bekor qilingan'],
  Tugallangan: [],
  'Bekor qilingan': [],
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function displayDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('uz-UZ', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function AppointmentsPage() {
  const { user } = useAdmin();
  const isSA = user.role === 'super_admin';
  const [appointments, setAppointments] = useState(null);
  const [stats, setStats] = useState(null);
  const [masters, setMasters] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: '', date_from: today(), date_to: '' });
  const [view, setView] = useState('list');
  const [editing, setEditing] = useState(null);
  const [converting, setConverting] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const { stats: s } = await api.get('/admin/appointments/stats');
      setStats(s);
    } catch {
      setStats(null);
    }
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const data = await api.get('/admin/appointments' + (params.toString() ? '?' + params.toString() : ''));
      setAppointments(data.appointments || []);
    } catch (err) {
      setError(err.message);
      setAppointments([]);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadStats();
    if (isSA) {
      api.get('/admin/users')
        .then(({ users }) => setMasters((users || []).filter((u) => u.role === 'master' && u.is_active)))
        .catch(() => {});
    } else {
      setMasters([{ id: user.id, full_name: user.full_name || user.username }]);
    }
  }, [isSA, user, loadStats]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function refresh() {
    await Promise.all([load(), loadStats()]);
  }

  async function changeStatus(appointment, status) {
    setError('');
    try {
      await api.patch(`/admin/appointments/${appointment.id}/status`, { status });
      setNotice(`Navbat "${status}" holatiga o'tkazildi`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmCancel() {
    setBusy(true);
    setError('');
    try {
      await api.del('/admin/appointments/' + cancelling.id);
      setCancelling(null);
      setNotice('Navbat bekor qilindi');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map();
    for (const appointment of appointments || []) {
      const key = appointment.scheduled_date || 'Sanasiz';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(appointment);
    }
    return [...map.entries()];
  }, [appointments]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--c-primary))]" />
            Qabul va navbatlar
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Navbatlar</h1>
          <p className="mt-1 text-sm text-white/50">Mijoz qabullarini rejalashtiring va ishga aylantiring.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link to="/admin/queue" className="btn-outline !py-2.5 text-sm">
            <Icon name="list" size={16} />
            Ish navbati
          </Link>
          <button type="button" onClick={refresh} className="rounded-xl border border-white/10 p-2.5 text-white/60 hover:bg-white/5" aria-label="Yangilash">
            <Icon name="refresh" size={17} />
          </button>
          <button type="button" onClick={() => setEditing({ scheduled_date: today(), scheduled_time: '09:00', status: 'Kutilayotgan' })} className="btn-primary !py-2.5 text-sm">
            <Icon name="pluss" size={16} />
            Yangi navbat
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Bugun" value={stats.today} icon="calendar" />
          <Stat label="Kutilayotgan" value={stats.waiting} icon="clock" />
          <Stat label="Tasdiqlangan" value={stats.confirmed} icon="check" />
          <Stat label="Jarayonda" value={stats.inProgress} icon="play" />
          <Stat label="Tugallangan" value={stats.completed} icon="flag" />
          <Stat label="Bekor" value={stats.cancelled} icon="xcircle" />
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 !p-4">
        <div className="min-w-[220px] flex-1">
          <label className="label">Qidirish</label>
          <input className="field" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Mijoz, telefon, mashina, xizmat..." />
        </div>
        <div>
          <label className="label">Holat</label>
          <select className="field" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="" className="bg-[#111725]">Barchasi</option>
            {STATUSES.map((status) => <option key={status} value={status} className="bg-[#111725]">{status}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Boshlanish</label>
          <input type="date" className="field" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))} />
        </div>
        <div>
          <label className="label">Tugash</label>
          <input type="date" className="field" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))} />
        </div>
        <div className="flex rounded-xl border border-white/10 p-1">
          <button type="button" onClick={() => setView('list')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${view === 'list' ? 'bg-white/10 text-white' : 'text-white/45'}`}>Ro'yxat</button>
          <button type="button" onClick={() => setView('calendar')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${view === 'calendar' ? 'bg-white/10 text-white' : 'text-white/45'}`}>Kalendar</button>
        </div>
      </div>

      {!appointments ? (
        <Loading label="Navbatlar yuklanmoqda..." />
      ) : appointments.length === 0 ? (
        <div className="card"><EmptyState icon="calendar" title="Navbat yo'q" hint="Yangi navbat qo'shing yoki sana oralig'ini o'zgartiring." /></div>
      ) : view === 'calendar' ? (
        <div className="space-y-5">
          {grouped.map(([date, rows]) => (
            <section key={date}>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-sm font-bold text-white">{date === 'Sanasiz' ? 'Sana belgilanmagan' : displayDate(date)}</h2>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/45">{rows.length} ta</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((a) => <AppointmentCard key={a.id} a={a} isSA={isSA} onEdit={() => setEditing(a)} onStatus={(s) => changeStatus(a, s)} onConvert={() => setConverting(a)} onCancel={() => setCancelling(a)} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((a) => (
            <div key={a.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-white/5">
                <span className="text-lg font-extrabold leading-none text-white">{a.scheduled_time || '--:--'}</span>
                <span className="mt-1 text-[10px] text-white/40">{a.scheduled_date?.slice(5) || ''}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold">{a.customer_name || a.customer_phone || 'Mijoz'}</h3>
                  <Badge kind={STATUS_STYLE[a.status] || 'default'}>{a.status}</Badge>
                  {a.work_log_id && <Badge kind="success">Ishga aylantirilgan</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
                  <span>{a.service_type}</span>
                  {(a.car_brand || a.car_model) && <span>{[a.car_brand, a.car_model].filter(Boolean).join(' ')} {a.car_number ? `· ${a.car_number}` : ''}</span>}
                  {a.customer_phone && <span>{a.customer_phone}</span>}
                  {a.master_name && <span>Usta: {a.master_name}</span>}
                </div>
                {a.notes && <p className="mt-1 line-clamp-1 text-xs text-white/40">{a.notes}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {NEXT_STATUS[a.status]?.filter((s) => s !== 'Bekor qilingan').map((s) => (
                  <button key={s} type="button" onClick={() => changeStatus(a, s)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5">{s}</button>
                ))}
                {!a.work_log_id && ['Kutilayotgan', 'Tasdiqlangan'].includes(a.status) && (
                  <button type="button" onClick={() => setConverting(a)} className="rounded-lg bg-[rgb(var(--c-primary))] px-3 py-1.5 text-xs font-semibold text-white">Ishga aylantirish</button>
                )}
                <button type="button" onClick={() => setEditing(a)} className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white" title="Tahrirlash"><Icon name="edit" size={16} /></button>
                {isSA && a.status !== 'Tugallangan' && a.status !== 'Bekor qilingan' && (
                  <button type="button" onClick={() => setCancelling(a)} className="rounded-lg p-2 text-white/50 hover:bg-red-500/10 hover:text-red-300" title="Bekor qilish"><Icon name="xcircle" size={16} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <AppointmentForm
          isSA={isSA}
          initial={editing}
          masters={masters}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); setNotice('Navbat saqlandi'); await refresh(); }}
        />
      )}
      {converting && (
        <ConvertForm
          appointment={converting}
          isSA={isSA}
          masters={masters}
          onClose={() => setConverting(null)}
          onSaved={async () => { setConverting(null); setNotice('Navbat ishga aylantirildi'); await refresh(); }}
        />
      )}
      <ConfirmDialog
        open={!!cancelling}
        title="Navbatni bekor qilish"
        message={`${cancelling?.customer_name || 'Mijoz'} uchun ${cancelling?.scheduled_date || ''} ${cancelling?.scheduled_time || ''} navbati bekor qilinadi.`}
        onCancel={() => setCancelling(null)}
        onConfirm={confirmCancel}
        busy={busy}
        confirmLabel="Bekor qilish"
        tone="warn"
      />
    </div>
  );
}

function Stat({ label, value, icon }) {
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-white/60"><Icon name={icon} size={17} /></span>
      <div><div className="text-lg font-extrabold leading-none">{value ?? '—'}</div><div className="mt-1 text-[11px] text-white/45">{label}</div></div>
    </div>
  );
}

function AppointmentCard({ a, isSA, onEdit, onStatus, onConvert, onCancel }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold">{a.scheduled_time || '--:--'} · {a.customer_name || 'Mijoz'}</div>
          <div className="mt-1 text-xs text-white/50">{a.service_type}</div>
        </div>
        <Badge kind={STATUS_STYLE[a.status] || 'default'}>{a.status}</Badge>
      </div>
      <div className="mt-2 space-y-1 text-xs text-white/45">
        {(a.car_brand || a.car_model) && <div>{[a.car_brand, a.car_model].filter(Boolean).join(' ')} {a.car_number ? `· ${a.car_number}` : ''}</div>}
        {a.customer_phone && <div>{a.customer_phone}</div>}
        {a.master_name && <div>Usta: {a.master_name}</div>}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
        {NEXT_STATUS[a.status]?.filter((s) => s !== 'Bekor qilingan').map((s) => (
          <button key={s} type="button" onClick={() => onStatus(s)} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/65 hover:bg-white/5">{s}</button>
        ))}
        {!a.work_log_id && ['Kutilayotgan', 'Tasdiqlangan'].includes(a.status) && (
          <button type="button" onClick={onConvert} className="rounded-lg bg-[rgb(var(--c-primary))] px-2 py-1 text-[11px] font-semibold text-white">Ishga aylantirish</button>
        )}
        <button type="button" onClick={onEdit} className="ml-auto rounded-lg p-1.5 text-white/45 hover:bg-white/10"><Icon name="edit" size={14} /></button>
        {isSA && !['Tugallangan', 'Bekor qilingan'].includes(a.status) && (
          <button type="button" onClick={onCancel} className="rounded-lg p-1.5 text-white/45 hover:bg-red-500/10 hover:text-red-300"><Icon name="xcircle" size={14} /></button>
        )}
      </div>
    </div>
  );
}

const EMPTY = {
  customer_id: '', vehicle_id: '', customer_name: '', customer_phone: '',
  car_brand: '', car_model: '', car_number: '', service_type: '',
  scheduled_date: '', scheduled_time: '', master_id: '', status: 'Kutilayotgan', notes: '',
};

function AppointmentForm({ isSA, initial, masters, onClose, onSaved }) {
  const isEdit = !!initial.id;
  const [form, setForm] = useState({ ...EMPTY, ...initial, master_id: initial.master_id || '', customer_id: initial.customer_id || '', vehicle_id: initial.vehicle_id || '' });
  const [customers, setCustomers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { names: services, loading: servicesLoading } = useServiceTypes({ fallback: [] });

  useEffect(() => {
    api.get('/admin/customers?per_page=100').then(({ customers: rows }) => setCustomers(rows || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.customer_id) { setVehicles([]); return; }
    api.get(`/admin/vehicles?customer_id=${form.customer_id}&per_page=100`)
      .then(({ vehicles: rows }) => setVehicles(rows || []))
      .catch(() => setVehicles([]));
  }, [form.customer_id]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function chooseCustomer(id) {
    const customer = customers.find((c) => String(c.id) === String(id));
    setForm((current) => ({
      ...current,
      customer_id: id,
      vehicle_id: '',
      customer_name: customer ? customer.full_name : current.customer_name,
      customer_phone: customer ? customer.phone : current.customer_phone,
    }));
  }

  function chooseVehicle(id) {
    const vehicle = vehicles.find((v) => String(v.id) === String(id));
    setForm((current) => ({
      ...current,
      vehicle_id: id,
      car_brand: vehicle ? vehicle.brand : current.car_brand,
      car_model: vehicle ? vehicle.model : current.car_model,
      car_number: vehicle ? vehicle.plate_number : current.car_number,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.customer_id) delete payload.customer_id;
      if (!payload.vehicle_id) delete payload.vehicle_id;
      if (!isSA) delete payload.master_id;
      else if (!payload.master_id) payload.master_id = '';
      if (isEdit) await api.put('/admin/appointments/' + initial.id, payload);
      else await api.post('/admin/appointments', payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Navbatni tahrirlash' : 'Yangi navbat'} wide footer={(
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
        <button type="submit" form="appointment-form" disabled={saving} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{saving ? 'Saqlanmoqda...' : 'Saqlash'}</button>
      </div>
    )}>
      <form id="appointment-form" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Mavjud mijoz</label>
            <select className="field" value={form.customer_id} onChange={(e) => chooseCustomer(e.target.value)}>
              <option value="" className="bg-[#111725]">Yangi mijoz</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id} className="bg-[#111725]">{customer.full_name} {customer.phone ? `· ${customer.phone}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mavjud avtomobil</label>
            <select className="field" value={form.vehicle_id} onChange={(e) => chooseVehicle(e.target.value)} disabled={!form.customer_id}>
              <option value="" className="bg-[#111725]">{form.customer_id ? 'Avtomobil tanlanmagan' : 'Avval mijozni tanlang'}</option>
              {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id} className="bg-[#111725]">{[vehicle.brand, vehicle.model].filter(Boolean).join(' ')} {vehicle.plate_number ? `· ${vehicle.plate_number}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mijoz ismi</label>
            <input className="field" value={form.customer_name} onChange={set('customer_name')} placeholder="Ali Valiyev" />
          </div>
          <div>
            <label className="label">Telefon</label>
            <input className="field" value={form.customer_phone} onChange={set('customer_phone')} placeholder="+998 90 000 00 00" />
          </div>
          <div>
            <label className="label">Avtomobil markasi</label>
            <input className="field" value={form.car_brand} onChange={set('car_brand')} placeholder="Chevrolet" />
          </div>
          <div>
            <label className="label">Model</label>
            <input className="field" value={form.car_model} onChange={set('car_model')} placeholder="Cobalt" />
          </div>
          <div>
            <label className="label">Davlat raqami</label>
            <input className="field" value={form.car_number} onChange={set('car_number')} placeholder="01 A 777 AA" />
          </div>
          <div>
            <label className="label">Xizmat turi *</label>
            <select className="field" value={form.service_type} onChange={set('service_type')} required disabled={servicesLoading}>
              <option value="" className="bg-[#111725]">{servicesLoading ? 'Yuklanmoqda...' : 'Tanlang...'}</option>
              {services.map((service) => <option key={service} value={service} className="bg-[#111725]">{service}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Sana *</label>
            <input type="date" className="field" value={form.scheduled_date} onChange={set('scheduled_date')} required />
          </div>
          <div>
            <label className="label">Vaqt *</label>
            <input type="time" className="field" value={form.scheduled_time} onChange={set('scheduled_time')} required />
          </div>
          {isSA && (
            <div>
              <label className="label">Usta</label>
              <select className="field" value={form.master_id} onChange={set('master_id')}>
                <option value="" className="bg-[#111725]">Tanlanmagan</option>
                {masters.map((master) => <option key={master.id} value={master.id} className="bg-[#111725]">{master.full_name || master.username}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Holat</label>
            <select className="field" value={form.status} onChange={set('status')} disabled={isEdit}>
              {STATUSES.map((status) => <option key={status} value={status} className="bg-[#111725]">{status}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Izoh</label>
          <textarea className="field min-h-[90px]" value={form.notes} onChange={set('notes')} placeholder="Mijoz e'tirozi, qo'shimcha ma'lumot..." />
        </div>
      </form>
    </Modal>
  );
}

function ConvertForm({ appointment, isSA, masters, onClose, onSaved }) {
  const [form, setForm] = useState({
    master_id: appointment.master_id || (isSA ? '' : ''),
    title: `${appointment.service_type} — ${appointment.customer_name || 'Mijoz'}`,
    price: '',
    currency: 'UZS',
    description: '',
    diagnosis: appointment.notes || '',
    notes: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.master_id) delete payload.master_id;
      if (payload.price === '') delete payload.price;
      await api.post(`/admin/appointments/${appointment.id}/convert`, payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Navbatni ishga aylantirish">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-sm">
          <div className="font-semibold">{appointment.customer_name || appointment.customer_phone}</div>
          <div className="mt-1 text-xs text-white/50">{appointment.service_type} · {appointment.scheduled_date} {appointment.scheduled_time}</div>
        </div>
        <div>
          <label className="label">Usta *</label>
          <select className="field" value={form.master_id} onChange={set('master_id')} required>
            <option value="" className="bg-[#111725]">Tanlang...</option>
            {masters.map((master) => <option key={master.id} value={master.id} className="bg-[#111725]">{master.full_name || master.username}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Ish nomi</label>
          <input className="field" value={form.title} onChange={set('title')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Narx</label>
            <input type="number" min="0" className="field" value={form.price} onChange={set('price')} placeholder="0" />
          </div>
          <div>
            <label className="label">Valyuta</label>
            <select className="field" value={form.currency} onChange={set('currency')}>
              <option value="UZS" className="bg-[#111725]">so'm</option>
              <option value="USD" className="bg-[#111725]">$ USD</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Tashxis</label>
          <textarea className="field min-h-[70px]" value={form.diagnosis} onChange={set('diagnosis')} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={saving} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{saving ? <Spinner className="h-4 w-4" /> : 'Ish yaratish'}</button>
        </div>
      </form>
    </Modal>
  );
}
