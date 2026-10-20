import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAdmin } from '../../store';
import Icon from '../../components/icons';
import { Loading, Alert, Badge, Modal, ConfirmDialog } from '../../components/ui';

const ICONS = ['diagnostic', 'bolt', 'battery', 'light', 'chip', 'engine', 'wrench', 'oil', 'car', 'settings'];

export default function ServicesPage() {
  const { user } = useAdmin();
  const [services, setServices] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = user.role === 'super_admin' || (Array.isArray(user.permissions) && user.permissions.includes('services'));

  async function load() {
    setError('');
    try {
      const data = await api.get('/admin/services');
      setServices(data.services || []);
    } catch (err) {
      setError(err.message);
      setServices([]);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  async function toggle(service) {
    try {
      await api.put('/admin/services/' + service.id, { is_active: !service.is_active });
      setNotice(service.is_active ? 'Xizmat yashirildi' : 'Xizmat faollashtirildi');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function move(index, direction) {
    const target = index + direction;
    if (!services || target < 0 || target >= services.length) return;
    const ids = services.map((service) => service.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const next = ids.map((id) => services.find((service) => service.id === id));
    setServices(next);
    try {
      await api.patch('/admin/services/reorder', { ids });
    } catch (err) {
      setError(err.message);
      await load();
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.del('/admin/services/' + deleting.id);
      setDeleting(null);
      setNotice('Xizmat o\'chirildi');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Xizmatlar</h1>
          <p className="mt-1 text-sm text-white/50">Sayt va ish qabulidagi xizmatlar katalogi.</p>
        </div>
        {canEdit && <button type="button" onClick={() => setEditing({})} className="btn-primary !py-2.5 text-sm"><Icon name="pluss" size={16} /> Yangi xizmat</button>}
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {!canEdit && <Alert kind="warn">Xizmatlarni tahrirlash uchun `services` ruxsati kerak.</Alert>}

      {!services ? <Loading label="Xizmatlar yuklanmoqda..." /> : services.length === 0 ? (
        <div className="card p-8 text-center text-sm text-white/50">Xizmatlar katalogi bo'sh.</div>
      ) : (
        <div className="space-y-2">
          {services.map((service, index) => (
            <div key={service.id} className={`card flex flex-wrap items-center gap-3 !p-4 ${Number(service.is_active) ? '' : 'opacity-60'}`}>
              <div className="flex flex-col">
                <button type="button" disabled={!canEdit || index === 0} onClick={() => move(index, -1)} className="rounded p-0.5 text-white/30 hover:text-white disabled:opacity-20"><Icon name="chevronup" size={14} /></button>
                <button type="button" disabled={!canEdit || index === services.length - 1} onClick={() => move(index, 1)} className="rounded p-0.5 text-white/30 hover:text-white disabled:opacity-20"><Icon name="chevrondown" size={14} /></button>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--c-primary))]/10 text-[rgb(var(--c-primary))]"><Icon name={service.icon || 'wrench'} size={20} /></span>
              {service.image && <img src={service.image} alt="" className="hidden h-11 w-16 rounded-lg object-cover sm:block" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{service.name}</span>
                  <Badge kind={Number(service.is_active) ? 'success' : 'default'}>{Number(service.is_active) ? 'Faol' : 'Yashirilgan'}</Badge>
                </div>
                <div className="mt-0.5 line-clamp-1 text-xs text-white/40">{service.description || 'Tavsif yo\'q'}{service.price ? ` · ${service.price}` : ''}</div>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => toggle(service)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/65 hover:bg-white/5">{Number(service.is_active) ? 'Yashirish' : 'Faollashtirish'}</button>
                  <button type="button" onClick={() => setEditing(service)} className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white" title="Tahrirlash"><Icon name="edit" size={16} /></button>
                  <button type="button" onClick={() => setDeleting(service)} className="rounded-lg p-2 text-white/45 hover:bg-red-500/10 hover:text-red-300" title="O'chirish"><Icon name="trash" size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && canEdit && <ServiceForm initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice('Xizmat saqlandi'); await load(); }} />}
      <ConfirmDialog open={!!deleting} title="Xizmatni o'chirish" message={`${deleting?.name || ''} katalogdan o'chiriladi. Mavjud ish yozuvlari saqlanadi.`} onCancel={() => setDeleting(null)} onConfirm={remove} busy={busy} confirmLabel="O'chirish" />
    </div>
  );
}

function ServiceForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: initial.name || '',
    description: initial.description || '',
    benefits: initial.benefits || '',
    image: initial.image || '',
    icon: initial.icon || 'wrench',
    price: initial.price || '',
    is_active: initial.id ? !!Number(initial.is_active) : true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (initial.id) await api.put('/admin/services/' + initial.id, form);
      else await api.post('/admin/services', form);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Xizmatni tahrirlash' : 'Yangi xizmat'}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div><label className="label">Nomi *</label><input className="field" value={form.name} onChange={set('name')} required placeholder="Elektrodiagnostika" /></div>
        <div><label className="label">Tavsif</label><textarea className="field min-h-[80px]" value={form.description} onChange={set('description')} /></div>
        <div><label className="label">Afzalliklar</label><textarea className="field min-h-[60px]" value={form.benefits} onChange={set('benefits')} placeholder="Har bir afzallik yangi qatorda" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Narx matni</label><input className="field" value={form.price} onChange={set('price')} placeholder="150 000 so'mdan" /></div>
          <div>
            <label className="label">Ikonka</label>
            <select className="field" value={form.icon} onChange={set('icon')}>
              {ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label">Rasm URL</label><input className="field" value={form.image} onChange={set('image')} placeholder="https://..." /></div>
        <label className="flex cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} className="h-4 w-4 accent-[rgb(var(--c-primary))]" /> Sayt va ish qabulida ko'rsatish</label>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={saving} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{saving ? 'Saqlanmoqda...' : 'Saqlash'}</button>
        </div>
      </form>
    </Modal>
  );
}
