import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { useAdmin } from '../../store';
import Icon from '../../components/icons';
import { Alert, ConfirmDialog, EmptyState, Spinner, Toggle } from '../../components/ui';
import StatusBadge, { STATUSES } from '../../components/StatusBadge';
import { SERVICE_NAMES, serviceIcon, serviceOptions } from '../../serviceCatalog';
import { useServiceTypes } from '../../serviceTypes';
import { WorkForm } from './WorkLogs';

const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
const PAGE_SIZES = [8, 16, 24, 50];

const EMPTY_FILTERS = {
  q: '',
  service_type: '',
  status: '',
  master_id: '',
  date_from: '',
  date_to: '',
};

export default function QueuePage() {
  const { user } = useAdmin();
  const isSA = user && user.role === 'super_admin';

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [masters, setMasters] = useState([]);
  const [publicShow, setPublicShow] = useState(false);
  const [savingPublic, setSavingPublic] = useState(false);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(8);

  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const requestSeq = useRef(0);

  const { names: serviceTypes } = useServiceTypes({ fallback: SERVICE_NAMES });

  const loadStats = useCallback(async () => {
    try {
      const { stats: s } = await api.get('/admin/worklogs/stats');
      setStats(s);
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    loadStats();
    if (!isSA) return;
    api.get('/admin/users')
      .then(({ users }) => setMasters((users || []).filter((u) => u.role === 'master')))
      .catch(() => {});
    api.get('/admin/settings/worklog')
      .then(({ settings }) => setPublicShow(settings.public_show === true))
      .catch(() => {});
  }, [isSA, loadStats]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadList = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per_page', String(perPage));
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const data = await api.get('/admin/worklogs?' + params.toString());
      if (seq !== requestSeq.current) return;
      setRows(data.worklogs || []);
      setPagination(data.pagination || null);
      if (data.pagination && data.pagination.page !== page) {
        setPage(data.pagination.page);
      }
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setListError(e.message || "Navbatlarni yuklab bo'lmadi");
      setRows([]);
      setPagination(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filters, page, perPage]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  function showToast(kind, text) {
    setToast({ kind, text, id: Date.now() });
  }

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  function resetFilters() {
    setSearch('');
    setFilters({ ...EMPTY_FILTERS });
    setPage(1);
  }

  async function refresh() {
    await Promise.all([loadList(), loadStats()]);
  }

  async function togglePublic() {
    if (savingPublic) return;
    setSavingPublic(true);
    try {
      await api.put('/admin/settings/worklog', { value: { public_show: !publicShow } });
      setPublicShow((v) => !v);
      showToast('success', !publicShow ? "Saytda ko'rsatish yoqildi" : "Saytda ko'rsatish o'chirildi");
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setSavingPublic(false);
    }
  }

  async function changeStatus(work, next) {
    setBusyId(work.id);
    try {
      await api.patch(`/admin/worklogs/${work.id}/status`, { status: next });
      const messages = {
        Jarayonda: 'Ish boshlandi',
        Tugallangan: 'Ish tugallandi',
        'Bekor qilingan': 'Navbat bekor qilindi',
      };
      showToast('success', messages[next] || 'Holat yangilandi');
      setConfirm(null);
      await Promise.all([loadList(), loadStats()]);
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeWork(work) {
    setBusyId(work.id);
    try {
      await api.del('/admin/worklogs/' + work.id);
      setConfirm(null);
      showToast('success', "Ish o'chirildi");
      await Promise.all([loadList(), loadStats()]);
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusyId(null);
    }
  }

  function askCancel(work) {
    setConfirm({ kind: 'cancel', work });
  }

  function askDelete(work) {
    setConfirm({ kind: 'delete', work });
  }

  const hasActiveFilters = useMemo(
    () => search.trim() !== '' || Object.values(filters).some((value) => String(value || '').trim() !== ''),
    [filters, search],
  );
  const total = pagination ? pagination.total : rows.length;
  const currentPage = pagination ? pagination.page : 1;
  const pages = pagination ? pagination.pages : 1;
  const from = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
  const to = Math.min(total, currentPage * perPage);
  const serviceList = serviceOptions(filters.service_type, serviceTypes);
  const showEmpty = !loading && !listError && rows.length === 0;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--admin-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--admin-red)]" />
            Xizmat navbati
          </div>
          <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-[var(--admin-text)] sm:text-3xl">
            Navbatlar ro'yxati
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--admin-muted)]">
            Kutilayotgan, jarayondagi va yakunlangan ishlarni bitta joydan boshqaring.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {isSA && (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-card)] px-3.5 py-2.5">
              <span className="text-xs font-medium text-[var(--admin-muted)]">Saytda ko'rsatish</span>
              <Toggle checked={publicShow} onChange={togglePublic} disabled={savingPublic} label="Saytda ko'rsatish" />
              {savingPublic && <Spinner className="h-4 w-4" />}
            </div>
          )}
          <button type="button" onClick={refresh} className="admin-btn-ghost !px-3" title="Yangilash" aria-label="Yangilash">
            <Icon name="refresh" size={17} />
          </button>
          <button type="button" onClick={() => setEditing({})} className="admin-btn-primary">
            <Icon name="pluss" size={17} />
            Yangi ish qo'shish
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="document"
          label="Jami navbatlar"
          value={stats ? stats.total : null}
          tone="red"
          hint={stats ? `${stats.waiting + stats.inProgress} ta faol navbat` : undefined}
        />
        <StatCard icon="list" label="Kutilayotgan" value={stats ? stats.waiting : null} tone="blue" />
        <StatCard icon="clock" label="Jarayonda" value={stats ? stats.inProgress : null} tone="orange" />
        <StatCard icon="check" label="Tugallangan" value={stats ? stats.completed : null} tone="green" />
      </section>

      <section className="admin-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--admin-text)]">Qidirish va filtrlash</h2>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className="admin-btn-ghost !py-1.5 !text-xs"
          >
            <Icon name="refresh" size={14} />
            Tozalash
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
          <div className="sm:col-span-2">
            <label className="admin-label" htmlFor="queue-search">Qidirish</label>
            <div className="relative">
              <Icon name="search" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--admin-muted)]" />
              <input
                id="queue-search"
                type="search"
                className="admin-field pl-10"
                placeholder="Mijoz, telefon, avtomobil yoki raqam..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="admin-label" htmlFor="queue-service">Xizmat turi</label>
            <select id="queue-service" className="admin-field" value={filters.service_type} onChange={(e) => setFilter('service_type', e.target.value)}>
              <option value="" className="bg-[#111725]">Barcha xizmatlar</option>
              {serviceList.map((option) => (
                <option key={option.value} value={option.value} className="bg-[#111725]">{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="admin-label" htmlFor="queue-status">Holat</label>
            <select id="queue-status" className="admin-field" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="" className="bg-[#111725]">Barcha holatlar</option>
              {STATUSES.map((status) => (
                <option key={status} value={status} className="bg-[#111725]">{status}</option>
              ))}
            </select>
          </div>
          {isSA && (
            <div>
              <label className="admin-label" htmlFor="queue-master">Usta</label>
              <select id="queue-master" className="admin-field" value={filters.master_id} onChange={(e) => setFilter('master_id', e.target.value)}>
                <option value="" className="bg-[#111725]">Barcha ustalar</option>
                {masters.map((master) => (
                  <option key={master.id} value={master.id} className="bg-[#111725]">{master.full_name || master.username}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="admin-label" htmlFor="queue-date-from">Boshlanish sanasi</label>
            <input id="queue-date-from" type="date" className="admin-field" value={filters.date_from} onChange={(e) => setFilter('date_from', e.target.value)} />
          </div>
          <div>
            <label className="admin-label" htmlFor="queue-date-to">Tugash sanasi</label>
            <input id="queue-date-to" type="date" className="admin-field" value={filters.date_to} onChange={(e) => setFilter('date_to', e.target.value)} />
          </div>
        </div>
      </section>

      {listError && !loading && (
        <Alert>
          Navbatlarni yuklab bo'lmadi: {listError}.{' '}
          <button type="button" onClick={refresh} className="font-semibold underline">Qayta urinish</button>
        </Alert>
      )}

      <section className="space-y-3">
        <div className="hidden overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-card)] lg:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-border)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--admin-muted)]">
                  <th className="px-4 py-3.5">#</th>
                  <th className="px-4 py-3.5">Mijoz ma'lumotlari</th>
                  <th className="px-4 py-3.5">Avtomobil</th>
                  <th className="px-4 py-3.5">Xizmat turi</th>
                  <th className="px-4 py-3.5">Holat</th>
                  <th className="px-4 py-3.5">Navbat vaqti</th>
                  <th className="px-4 py-3.5">Usta</th>
                  <th className="px-4 py-3.5 text-right">Harakatlar</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows />
                ) : rows.map((work, index) => (
                  <QueueRow
                    key={work.id}
                    work={work}
                    number={pagination ? (currentPage - 1) * perPage + index + 1 : index + 1}
                    busy={busyId === work.id}
                    onEdit={() => setEditing(work)}
                    onStart={() => changeStatus(work, 'Jarayonda')}
                    onComplete={() => changeStatus(work, 'Tugallangan')}
                    onCancel={() => askCancel(work)}
                    onDelete={() => askDelete(work)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {showEmpty && (
            <EmptyQueue isSA={isSA} hasActiveFilters={hasActiveFilters} onReset={resetFilters} onCreate={() => setEditing({})} />
          )}
        </div>

        <div className="space-y-3 lg:hidden">
          {loading && <MobileSkeleton />}
          {!loading && !listError && rows.map((work, index) => (
            <QueueCard
              key={work.id}
              work={work}
              number={pagination ? (currentPage - 1) * perPage + index + 1 : index + 1}
              busy={busyId === work.id}
              onEdit={() => setEditing(work)}
              onStart={() => changeStatus(work, 'Jarayonda')}
              onComplete={() => changeStatus(work, 'Tugallangan')}
              onCancel={() => askCancel(work)}
              onDelete={() => askDelete(work)}
            />
          ))}
          {showEmpty && (
            <div className="admin-card">
              <EmptyQueue isSA={isSA} hasActiveFilters={hasActiveFilters} onReset={resetFilters} onCreate={() => setEditing({})} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--admin-muted)]">
            {pagination
              ? `Jami ${total} ta navbatdan ${from}–${to} tasi ko'rsatilmoqda`
              : `Jami ${total} ta navbat ko'rsatilmoqda`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="queue-per-page" className="text-xs text-[var(--admin-muted)]">Sahifada</label>
            <select
              id="queue-per-page"
              className="admin-field !w-20 !py-1.5 !text-xs"
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            >
              {PAGE_SIZES.map((size) => <option key={size} value={size} className="bg-[#111725]">{size}</option>)}
            </select>
            <button type="button" className="admin-icon-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1 || loading} aria-label="Oldingi sahifa">
              <Icon name="chevronleft" size={17} />
            </button>
            <span className="min-w-[54px] text-center text-xs font-semibold text-[var(--admin-text)]">{currentPage} / {pages}</span>
            <button type="button" className="admin-icon-btn" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={currentPage >= pages || loading} aria-label="Keyingi sahifa">
              <Icon name="chevronright" size={17} />
            </button>
          </div>
        </div>
      </section>

      {editing && (
        <WorkForm
          isSA={isSA}
          initial={editing}
          defaultStatus="Kutilayotgan"
          masters={masters}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            const wasEdit = !!editing.id;
            setEditing(null);
            showToast('success', wasEdit ? 'Ish yangilandi' : "Yangi ish qo'shildi");
            await Promise.all([loadList(), loadStats()]);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm && confirm.kind === 'delete' ? "Ishni o'chirish" : 'Navbatni bekor qilish'}
        message={
          confirm && confirm.kind === 'delete'
            ? `"${confirm.work.title}" yozuvi, rasmlari va materiallari butunlay o'chiriladi. Bu amalni qaytarib bo'lmaydi.`
            : `"${confirm ? confirm.work.title : ''}" navbati bekor qilinadi. Yozuv o'chirilmaydi, "Bekor qilingan" holatida saqlanadi.`
        }
        confirmLabel={confirm && confirm.kind === 'delete' ? "O'chirish" : 'Ha, bekor qilish'}
        cancelLabel="Yopish"
        tone={confirm && confirm.kind === 'delete' ? 'danger' : 'warn'}
        busy={!!confirm && busyId === confirm.work.id}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'delete') removeWork(confirm.work);
          else changeStatus(confirm.work, 'Bekor qilingan');
        }}
      />

      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl ${
            toast.kind === 'success'
              ? 'border-emerald-500/30 bg-[#0f2a21] text-emerald-200'
              : 'border-red-500/30 bg-[#2a1113] text-red-200'
          }`}
          role="status"
        >
          <Icon name={toast.kind === 'success' ? 'check' : 'xcircle'} size={18} />
          <span className="pt-0.5">{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Yopish">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, tone, hint }) {
  const tones = {
    red: 'bg-[#ff101a]/10 text-[#ff5a61] ring-[#ff101a]/25',
    blue: 'bg-[#079cf0]/10 text-[#4cc2ff] ring-[#079cf0]/25',
    orange: 'bg-[#ffaa00]/10 text-[#ffc247] ring-[#ffaa00]/25',
    green: 'bg-[#00c98b]/10 text-[#3ee0b0] ring-[#00c98b]/25',
  };
  return (
    <div className="admin-card flex items-center gap-4 p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ${tones[tone] || tones.red}`}>
        <Icon name={icon} size={22} />
      </span>
      <div className="min-w-0">
        <div className="text-2xl font-extrabold leading-none tracking-tight text-[var(--admin-text)]">
          {value === null || value === undefined ? '—' : Number(value).toLocaleString('uz-UZ')}
        </div>
        <div className="mt-1.5 text-xs font-medium text-[var(--admin-muted)]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-[var(--admin-muted)] opacity-70">{hint}</div>}
      </div>
    </div>
  );
}

function QueueRow({ work, number, busy, onEdit, onStart, onComplete, onCancel, onDelete }) {
  const date = formatDate(work.start_date);
  return (
    <tr className="border-b border-[var(--admin-border)] transition-colors last:border-0 hover:bg-white/[0.025]">
      <td className="px-4 py-3.5">
        <span className="inline-flex min-w-[36px] items-center justify-center rounded-lg border border-[var(--admin-border)] bg-white/[0.03] px-2 py-1 text-xs font-bold text-[var(--admin-muted)]">
          #{number}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={work.customer_name} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-[var(--admin-text)]">{work.customer_name || 'Mijoz'}</div>
            <div className="truncate text-xs text-[var(--admin-muted)]">{work.customer_phone || 'Telefon kiritilmagan'}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="font-medium text-[var(--admin-text)]">
          {[work.car_brand, work.car_model].filter(Boolean).join(' ') || '—'}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--admin-muted)]">
          <Icon name="car" size={13} />
          {work.car_number ? (
            <span className="rounded border border-[var(--admin-border)] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide">
              {work.car_number}
            </span>
          ) : (
            <span>Raqam yo'q</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-[var(--admin-text)]">
          <Icon name={serviceIcon(work.service_type)} size={14} className="text-[var(--admin-muted)]" />
          <span className="max-w-[150px] truncate">{work.service_type || '—'}</span>
        </span>
      </td>
      <td className="px-4 py-3.5"><StatusBadge status={work.status} /></td>
      <td className="px-4 py-3.5">
        <div className="whitespace-nowrap text-xs font-medium text-[var(--admin-text)]">{date || 'Belgilanmagan'}</div>
        {work.scheduled_time && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--admin-muted)]">
            <Icon name="clock" size={12} />
            {work.scheduled_time}
          </div>
        )}
      </td>
      <td className="px-4 py-3.5">
        {work.master_name ? (
          <div className="flex items-center gap-2">
            <Avatar name={work.master_name} small />
            <span className="max-w-[130px] truncate text-xs font-medium text-[var(--admin-text)]">{work.master_name}</span>
          </div>
        ) : (
          <span className="text-xs text-[var(--admin-muted)]">Tayinlanmagan</span>
        )}
      </td>
      <td className="px-4 py-3.5">
        {busy ? (
          <div className="flex justify-end pr-2"><Spinner className="h-4 w-4" /></div>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            {work.status === 'Kutilayotgan' && (
              <ActionButton icon="play" label="Ishni boshlash" tone="blue" onClick={onStart} />
            )}
            {work.status === 'Jarayonda' && (
              <ActionButton icon="check" label="Tugallash" tone="green" onClick={onComplete} />
            )}
            <ActionButton icon="edit" label="Tahrirlash" onClick={onEdit} />
            {(work.status === 'Kutilayotgan' || work.status === 'Jarayonda') && (
              <ActionButton icon="xcircle" label="Bekor qilish" tone="amber" onClick={onCancel} />
            )}
            <ActionButton icon="trash" label="O'chirish" tone="red" onClick={onDelete} />
          </div>
        )}
      </td>
    </tr>
  );
}

function QueueCard({ work, number, busy, onEdit, onStart, onComplete, onCancel, onDelete }) {
  const date = formatDate(work.start_date);
  return (
    <div className="admin-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={work.customer_name} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-[var(--admin-text)]">{work.customer_name || 'Mijoz'}</div>
            <div className="truncate text-xs text-[var(--admin-muted)]">{work.customer_phone || 'Telefon kiritilmagan'}</div>
          </div>
        </div>
        <StatusBadge status={work.status} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Avtomobil</div>
          <div className="mt-0.5 font-medium text-[var(--admin-text)]">{[work.car_brand, work.car_model].filter(Boolean).join(' ') || '—'}</div>
          {work.car_number && <div className="mt-0.5 font-mono text-[10px] text-[var(--admin-muted)]">{work.car_number}</div>}
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Xizmat turi</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-medium text-[var(--admin-text)]">
            <Icon name={serviceIcon(work.service_type)} size={13} className="text-[var(--admin-muted)]" />
            <span className="truncate">{work.service_type || '—'}</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Navbat vaqti</div>
          <div className="mt-0.5 font-medium text-[var(--admin-text)]">{date || 'Belgilanmagan'}{work.scheduled_time ? ` · ${work.scheduled_time}` : ''}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Usta</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-medium text-[var(--admin-text)]">
            {work.master_name ? (
              <><Avatar name={work.master_name} small /><span className="truncate">{work.master_name}</span></>
            ) : (
              <span className="text-[var(--admin-muted)]">Tayinlanmagan</span>
            )}
          </div>
        </div>
      </div>

      {work.description && <p className="mt-3 line-clamp-2 text-xs text-[var(--admin-muted)]">{work.description}</p>}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--admin-border)] pt-3">
        <span className="text-[11px] font-semibold text-[var(--admin-muted)]">#{number}</span>
        {busy ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <div className="flex items-center gap-0.5">
            {work.status === 'Kutilayotgan' && (
              <ActionButton icon="play" label="Ishni boshlash" tone="blue" onClick={onStart} />
            )}
            {work.status === 'Jarayonda' && (
              <ActionButton icon="check" label="Tugallash" tone="green" onClick={onComplete} />
            )}
            <ActionButton icon="edit" label="Tahrirlash" onClick={onEdit} />
            {(work.status === 'Kutilayotgan' || work.status === 'Jarayonda') && (
              <ActionButton icon="xcircle" label="Bekor qilish" tone="amber" onClick={onCancel} />
            )}
            <ActionButton icon="trash" label="O'chirish" tone="red" onClick={onDelete} />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, tone = 'default', disabled = false }) {
  const tones = {
    default: 'text-[var(--admin-muted)] hover:bg-white/[0.06] hover:text-[var(--admin-text)]',
    green: 'text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300',
    blue: 'text-sky-400 hover:bg-sky-500/10 hover:text-sky-300',
    amber: 'text-amber-400 hover:bg-amber-500/10 hover:text-amber-300',
    red: 'text-red-400 hover:bg-red-500/10 hover:text-red-300',
  };
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${tones[tone] || tones.default}`}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

function Avatar({ name, small = false }) {
  const initials = getInitials(name);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full ring-1 ${avatarTone(name)} ${small ? 'h-6 w-6 text-[9px]' : 'h-9 w-9 text-[11px]'} font-bold uppercase`}
    >
      {initials}
    </span>
  );
}

function EmptyQueue({ isSA, hasActiveFilters, onReset, onCreate }) {
  return (
    <div className="px-4 py-8">
      <EmptyState
        icon="list"
        title="Navbatlar topilmadi"
        hint={
          hasActiveFilters
            ? "Qidiruv yoki filtrlarga mos navbat yo'q. Filtrlarni tozalab qayta urinib ko'ring."
            : isSA
              ? "Hali navbat qo'shilmagan. Birinchi ishni qo'shishdan boshlang."
              : "Sizga biriktirilgan navbat hozircha yo'q."
        }
      />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {hasActiveFilters && (
          <button type="button" onClick={onReset} className="admin-btn-ghost">
            <Icon name="refresh" size={15} />
            Filtrlarni tozalash
          </button>
        )}
        <button type="button" onClick={onCreate} className="admin-btn-primary">
          <Icon name="pluss" size={15} />
          Yangi ish qo'shish
        </button>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return Array.from({ length: 6 }).map((_, row) => (
    <tr key={row} className="border-b border-[var(--admin-border)]">
      {Array.from({ length: 8 }).map((__, col) => (
        <td key={col} className="px-4 py-4">
          <div className={`h-3.5 animate-pulse rounded bg-white/[0.06] ${col === 0 ? 'w-8' : col === 1 ? 'w-36' : col === 7 ? 'ml-auto w-24' : 'w-20'}`} />
        </td>
      ))}
    </tr>
  ));
}

function MobileSkeleton() {
  return Array.from({ length: 4 }).map((_, index) => (
    <div key={index} className="admin-card space-y-3 p-4">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 animate-pulse rounded-full bg-white/[0.06]" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((__, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-white/[0.06]" />
        ))}
      </div>
    </div>
  ));
}

function formatDate(value) {
  if (!value) return '';
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const month = Number(match[2]) - 1;
    if (month >= 0 && month < 12) return `${match[3]} ${MONTHS[month]}, ${match[1]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]}, ${date.getFullYear()}`;
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

const AVATAR_TONES = [
  'bg-red-500/15 text-red-300 ring-red-500/25',
  'bg-sky-500/15 text-sky-300 ring-sky-500/25',
  'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  'bg-amber-500/15 text-amber-300 ring-amber-500/25',
  'bg-violet-500/15 text-violet-300 ring-violet-500/25',
  'bg-cyan-500/15 text-cyan-300 ring-cyan-500/25',
];

function avatarTone(seed) {
  const text = String(seed || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
