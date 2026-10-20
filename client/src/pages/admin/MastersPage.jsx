import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAdmin } from '../../store';
import Icon from '../../components/icons';
import { Loading, Alert, Badge, Modal, ConfirmDialog } from '../../components/ui';
import { money } from '../../money';

const PERMISSIONS = [
  { key: 'content', label: 'Sayt kontenti', hint: 'Sozlamalar va kontentni tahrirlash' },
  { key: 'services', label: 'Xizmatlar', hint: 'Xizmat katalogini boshqarish' },
  { key: 'media', label: 'Media', hint: 'Rasm yuklash va o\'chirish' },
];

function permissionsOf(user) {
  try {
    const parsed = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '[]') : user.permissions;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function MastersPage() {
  const { user } = useAdmin();
  const isSA = user.role === 'super_admin';
  const [users, setUsers] = useState(null);
  const [stats, setStats] = useState({});
  const [applications, setApplications] = useState([]);
  const [editing, setEditing] = useState(null);
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [data, applicationData] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/applications?status=pending'),
      ]);
      const masters = (data.users || []).filter((item) => item.role === 'master');
      setUsers(masters);
      setApplications(applicationData.applications || []);
      const pairs = await Promise.all(masters.map(async (master) => {
        try {
          const result = await api.get(`/admin/worklogs/stats?master_id=${master.id}`);
          return [master.id, result.stats || null];
        } catch {
          return [master.id, null];
        }
      }));
      setStats(Object.fromEntries(pairs));
    } catch (err) {
      setError(err.message);
      setUsers([]);
    }
  }, []);

  useEffect(() => { if (isSA) load(); }, [isSA, load]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  async function toggleActive(master) {
    setBusyId(master.id);
    setError('');
    try {
      await api.put('/admin/users/' + master.id, { is_active: !master.is_active });
      setNotice(master.is_active ? 'Usta bloklandi' : 'Usta faollashtirildi');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function approve() {
    setActionBusy(true);
    setError('');
    try {
      await api.post(`/admin/applications/${approving.id}/approve`);
      setApproving(null);
      setNotice('Ariza tasdiqlandi va usta yaratildi');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function reject() {
    setActionBusy(true);
    setError('');
    try {
      await api.post(`/admin/applications/${rejecting.id}/reject`, { reason: rejectReason.trim() });
      setRejecting(null);
      setRejectReason('');
      setNotice('Ariza rad etildi');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  if (!isSA) return <Alert>Ustalar bo'limi faqat super admin uchun.</Alert>;
  if (!users) return <Loading label="Ustalar yuklanmoqda..." />;

  const active = users.filter((master) => master.is_active).length;
  const totalWorks = Object.values(stats).reduce((sum, item) => sum + Number(item?.total || 0), 0);
  const earnings = Object.values(stats).reduce((sum, item) => sum + Number(item?.earnings || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Ustalar</h1>
          <p className="mt-1 text-sm text-white/50">Ustalar, ularning ish yuklamasi va ruxsatlari.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white/70 hover:bg-white/5"><Icon name="refresh" size={16} /></button>
          <button type="button" onClick={() => setEditing({})} className="btn-primary !py-2.5 text-sm"><Icon name="pluss" size={16} /> Yangi usta</button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Faol ustalar" value={active} icon="user" />
        <Metric label="Jami ustalar" value={users.length} icon="user" />
        <Metric label="Jami ishlar" value={totalWorks} icon="wrench" />
        <Metric label="Tushum (so'm)" value={money(earnings)} icon="money" />
      </div>

      {applications.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div><h2 className="font-bold">Usta arizalari</h2><p className="mt-0.5 text-xs text-white/40">Tasdiqlanganda usta akkaunti avtomatik yaratiladi.</p></div>
            <Badge kind="warn">{applications.length} ta kutilmoqda</Badge>
          </div>
          <div className="divide-y divide-white/5">
            {applications.map((application) => (
              <div key={application.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{application.full_name}</div>
                  <div className="text-xs text-white/45">@{application.username} · {application.email} · {application.phone || 'telefon yo\'q'}</div>
                  {application.specialty && <div className="mt-0.5 text-xs text-white/40">Mutaxassislik: {application.specialty}</div>}
                  {application.message && <p className="mt-1 line-clamp-2 text-xs text-white/35">{application.message}</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setRejecting(application)} className="rounded-lg border border-red-500/20 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10">Rad etish</button>
                  <button type="button" onClick={() => setApproving(application)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">Tasdiqlash</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {users.length === 0 ? (
        <div className="card p-8 text-center text-sm text-white/50">Usta qo'shilmagan.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {users.map((master) => {
            const stat = stats[master.id];
            const done = Number(stat?.completed || 0);
            const total = Number(stat?.total || 0);
            const progress = total ? Math.round((done / total) * 100) : 0;
            return (
              <div key={master.id} className="card !p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgb(var(--c-primary))]/15 text-sm font-extrabold text-[rgb(var(--c-primary))]">{initials(master.full_name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-bold">{master.full_name}</div>
                        <div className="text-xs text-white/45">@{master.username}</div>
                      </div>
                      <Badge kind={master.is_active ? 'success' : 'danger'}>{master.is_active ? 'Faol' : 'Bloklangan'}</Badge>
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-xs text-white/50">
                  <div className="truncate">{master.email || 'Email yo\'q'}</div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {permissionsOf(master).length === 0 ? <span className="text-white/35">Qo'shimcha ruxsat yo'q</span> : permissionsOf(master).map((permission) => <span key={permission} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-white/60">{permission}</span>)}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-white/[0.03] py-2"><div className="font-bold text-white/85">{stat?.inProgress ?? 0}</div><div className="text-white/40">Jarayonda</div></div>
                  <div className="rounded-lg bg-white/[0.03] py-2"><div className="font-bold text-white/85">{done}</div><div className="text-white/40">Tugallangan</div></div>
                  <div className="rounded-lg bg-white/[0.03] py-2"><div className="font-bold text-white/85">{money(stat?.earnings || 0)}</div><div className="text-white/40">Tushum</div></div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-white/40"><span>Bajarilish</span><span>{progress}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[rgb(var(--c-primary))]" style={{ width: `${progress}%` }} /></div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => setEditing(master)} className="flex-1 rounded-lg border border-white/10 py-2 text-xs text-white/75 hover:bg-white/5">Tahrirlash</button>
                  <button type="button" onClick={() => toggleActive(master)} disabled={busyId === master.id} className={`flex-1 rounded-lg border py-2 text-xs disabled:opacity-50 ${master.is_active ? 'border-red-500/20 text-red-300 hover:bg-red-500/10' : 'border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/10'}`}>{master.is_active ? 'Bloklash' : 'Faollashtirish'}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <MasterForm initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice('Usta saqlandi'); await load(); }} />}
      <ConfirmDialog open={!!approving} title="Arizani tasdiqlash" message={`${approving?.full_name || ''} uchun usta akkaunti yaratiladi va ariza tasdiqlanadi.`} onCancel={() => setApproving(null)} onConfirm={approve} busy={actionBusy} confirmLabel="Tasdiqlash" tone="primary" />
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Arizani rad etish">
        <div className="space-y-4">
          <p className="text-sm text-white/60">{rejecting?.full_name} arizasi rad etiladi.</p>
          <div><label className="label">Sabab (ixtiyoriy)</label><textarea className="field min-h-[80px]" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} /></div>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setRejecting(null)} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button><button type="button" onClick={reject} disabled={actionBusy} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60">Rad etish</button></div>
        </div>
      </Modal>
    </div>
  );
}

function Metric({ label, value, icon }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white/60"><Icon name={icon} size={18} /></span>
      <div className="min-w-0"><div className="truncate text-lg font-extrabold leading-none">{value}</div><div className="mt-1 text-xs text-white/45">{label}</div></div>
    </div>
  );
}

function MasterForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    full_name: initial.full_name || '',
    username: initial.username || '',
    email: initial.email || '',
    password: '',
    permissions: permissionsOf(initial),
    is_active: initial.id ? !!initial.is_active : true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const togglePermission = (key) => setForm((current) => ({ ...current, permissions: current.permissions.includes(key) ? current.permissions.filter((item) => item !== key) : [...current.permissions, key] }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        full_name: form.full_name,
        username: form.username,
        email: form.email,
        permissions: form.permissions,
        is_active: form.is_active,
        role: 'master',
      };
      if (form.password) payload.password = form.password;
      if (initial.id) await api.put('/admin/users/' + initial.id, payload);
      else await api.post('/admin/users', payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Ustani tahrirlash' : 'Yangi usta'}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div><label className="label">To'liq ism *</label><input className="field" value={form.full_name} onChange={set('full_name')} required minLength={3} placeholder="Ali Valiyev" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Username *</label><input className="field" value={form.username} onChange={set('username')} required placeholder="usta1" /></div>
          <div><label className="label">Email *</label><input type="email" className="field" value={form.email} onChange={set('email')} required placeholder="usta@amper.uz" /></div>
        </div>
        <div>
          <label className="label">{initial.id ? 'Yangi parol (bo\'sh qoldirilsa o\'zgarmaydi)' : 'Parol *'}</label>
          <input type="password" className="field" value={form.password} onChange={set('password')} required={!initial.id} minLength={8} autoComplete="new-password" />
          <p className="mt-1 text-xs text-white/35">Kamida 8 belgi.</p>
        </div>
        <div>
          <label className="label">Qo'shimcha ruxsatlar</label>
          <div className="space-y-2">
            {PERMISSIONS.map((permission) => (
              <label key={permission.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 hover:bg-white/[0.03]">
                <input type="checkbox" checked={form.permissions.includes(permission.key)} onChange={() => togglePermission(permission.key)} className="h-4 w-4 accent-[rgb(var(--c-primary))]" />
                <span><span className="block text-sm">{permission.label}</span><span className="block text-xs text-white/40">{permission.hint}</span></span>
              </label>
            ))}
          </div>
        </div>
        {initial.id && <label className="flex cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} className="h-4 w-4 accent-[rgb(var(--c-primary))]" /> Faol</label>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={saving} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{saving ? 'Saqlanmoqda...' : 'Saqlash'}</button>
        </div>
      </form>
    </Modal>
  );
}
