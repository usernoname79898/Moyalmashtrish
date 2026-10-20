import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdmin, useSite } from '../../store';
import { api } from '../../api';
import Icon from '../../components/icons';
import { Spinner, Modal, Alert } from '../../components/ui';

const NAV = [
  { to: '/admin/worklogs', icon: 'document', label: 'Bajarilgan ishlar' },
  { to: '/admin/queue', icon: 'calendar', label: 'Navbatlar' },
  { to: '/admin/customers', icon: 'user', label: 'Mijozlar' },
  { to: '/admin/debts', icon: 'money', label: 'Qarz daftari' },
  { to: '/admin/services', icon: 'wrench', label: 'Xizmatlar', permission: 'services' },
  { to: '/admin/masters', icon: 'user', label: 'Ustalar', adminOnly: true },
  { to: '/admin/vehicles', icon: 'car', label: 'Avtomobillar' },
  { to: '/admin/statistics', icon: 'dashboard', label: 'Statistika' },
  { to: '/admin/settings', icon: 'settings', label: 'Sayt sozlamalari', permission: 'content' },
];

function canSee(item, user) {
  if (item.adminOnly && user.role !== 'super_admin') return false;
  if (item.permission && user.role !== 'super_admin') {
    const list = Array.isArray(user.permissions) ? user.permissions : [];
    return list.includes(item.permission);
  }
  return true;
}

export default function AdminLayout() {
  const { user, logout } = useAdmin();
  const { siteLoading } = useSite();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState(null);
  const [notifLoading, setNotifLoading] = useState(false);
  const navigate = useNavigate();

  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const data = await api.get('/admin/notifications');
      setNotifications(data);
    } catch {
      setNotifications({ notifications: [], total: 0 });
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 60000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  async function doLogout() {
    setConfirm(false);
    await logout();
    navigate('/admin/login', { replace: true });
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[var(--admin-bg)] text-[var(--admin-text)] lg:flex lg:h-screen lg:overflow-hidden">
      {siteLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0d16]/80 backdrop-blur-sm">
          <Spinner className="h-10 w-10" />
        </div>
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[var(--admin-border)] bg-[var(--admin-sidebar)] transition-transform lg:static lg:h-full lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="relative flex h-16 items-center gap-2.5 border-b border-[var(--admin-border)] px-5">
          <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgb(var(--c-primary))]/60 to-transparent" aria-hidden="true" />
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[rgb(var(--c-primary))] to-[rgb(var(--c-secondary))] text-white shadow-lg shadow-[rgb(var(--c-primary))/25]">
            <Icon name="bolt" size={18} />
          </span>
          <div>
            <div className="text-sm font-extrabold leading-tight tracking-tight">Amper Admin</div>
            <div className="text-[11px] text-white/40">{user.role === 'super_admin' ? 'Super admin' : 'Usta'}</div>
          </div>
          <button type="button" className="ml-auto rounded-lg p-1.5 text-white/50 hover:bg-white/10 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Yopish">
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV.filter((n) => canSee(n, user)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${isActive ? 'bg-[rgb(var(--c-primary))] text-white shadow-lg shadow-[rgb(var(--c-primary))/25]' : 'text-white/60 hover:bg-white/5 hover:text-white'}`
              }
            >
              <Icon name={n.icon} size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-[var(--admin-border)] p-3 space-y-1">
          <button type="button" onClick={() => setPwdOpen(true)} className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white">
            <Icon name="lock" size={18} />
            Parolni o'zgartirish
          </button>
          <button type="button" onClick={() => setConfirm(true)} className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-red-400/80 transition hover:bg-red-500/10 hover:text-red-300">
            <Icon name="logout" size={18} />
            Chiqish
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col lg:h-full">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--admin-border)] bg-[#0b0d16]/90 px-4 backdrop-blur-lg sm:px-6">
          <button type="button" className="rounded-lg p-2 text-white/70 hover:bg-white/10 lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Menyu">
            <Icon name="menu" size={20} />
          </button>
          <h1 className="text-sm font-semibold text-white/80">Boshqaruv paneli</h1>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative">
              <button type="button" onClick={() => { setNotifOpen((open) => !open); if (!notifOpen) loadNotifications(); }} className="relative rounded-xl border border-white/10 p-2 text-white/65 transition hover:bg-white/5 hover:text-white" aria-label="Bildirishnomalar">
                <Icon name="bell" size={17} />
                {Number(notifications?.total) > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{notifications.total > 99 ? '99+' : notifications.total}</span>}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-white/10 bg-[#111725] shadow-2xl">
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <span className="text-sm font-bold">Bildirishnomalar</span>
                      <button type="button" onClick={loadNotifications} className="text-white/40 hover:text-white"><Icon name="refresh" size={14} /></button>
                    </div>
                    {notifLoading && !notifications ? <div className="py-8 text-center text-xs text-white/40">Yuklanmoqda...</div> : !notifications || notifications.notifications.length === 0 ? (
                      <div className="py-8 text-center text-xs text-white/40">Yangi bildirishnoma yo'q</div>
                    ) : (
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.notifications.map((item) => (
                          <button key={item.id} type="button" onClick={() => { setNotifOpen(false); navigate(item.to); }} className="flex w-full items-start gap-3 border-b border-white/5 px-4 py-3 text-left transition last:border-0 hover:bg-white/5">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/55"><Icon name={item.kind === 'payment' ? 'money' : item.kind === 'appointment' ? 'calendar' : item.kind === 'debt' ? 'money' : item.kind === 'application' ? 'user' : item.kind === 'stock' ? 'box' : 'document'} size={15} /></span>
                            <span className="min-w-0"><span className="block text-sm text-white/80">{item.title}</span><span className="mt-0.5 block text-xs text-white/40">{item.detail}</span></span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 sm:block">{user.username}</span>
            <a href="/" className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/5" target="_blank" rel="noreferrer">
              <Icon name="home" size={14} />
              Saytni ko'rish
            </a>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      <ConfirmLogout open={confirm} onCancel={() => setConfirm(false)} onConfirm={doLogout} />
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} onPasswordChanged={doLogout} />
    </div>
  );
}

function ConfirmLogout({ open, onCancel, onConfirm }) {
  return (
    <Modal open={open} onClose={onCancel} title="Chiqish">
      <p className="text-sm text-white/70">Haqiqatan ham tizimdan chiqmoqchimisiz?</p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
        <button type="button" onClick={onConfirm} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500">Chiqish</button>
      </div>
    </Modal>
  );
}

function ChangePasswordModal({ open, onClose, onPasswordChanged }) {
  const [form, setForm] = useState({ current_password: '', new_password: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.post('/admin/change-password', form);
      setForm({ current_password: '', new_password: '' });
      if (res && res.reauth) {
        // The server revokes every session on a password change, so send the user
        // back to the login screen instead of leaving a dead cookie behind.
        onClose();
        onPasswordChanged();
        return;
      }
      setMsg({ kind: 'success', text: 'Parol muvaffaqiyatli o\'zgartirildi' });
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Parolni o'zgartirish">
      <form onSubmit={onSubmit} className="space-y-4">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div>
          <label className="label">Joriy parol</label>
          <input type="password" className="field" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} required />
        </div>
        <div>
          <label className="label">Yangi parol (kamida 8 belgi)</label>
          <input type="password" className="field" minLength={8} value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} required />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5">Bekor qilish</button>
          <button type="submit" disabled={busy} className="btn-primary !py-2.5 text-sm disabled:opacity-60">{busy ? 'Jarayonda...' : 'Saqlash'}</button>
        </div>
      </form>
    </Modal>
  );
}