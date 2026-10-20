import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAdmin } from '../../store';
import Icon from '../../components/icons';
import { Loading, Alert, Badge } from '../../components/ui';
import { money } from '../../money';

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function shortDay(value) {
  if (!value) return '';
  const parts = String(value).split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}` : value;
}

export default function StatisticsPage() {
  const { user } = useAdmin();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(today());
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams({ date_from: from, date_to: to });
      setData(await api.get('/admin/statistics?' + params.toString()));
    } catch (err) {
      setError(err.message);
      setData(null);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  function pick(days) {
    setRange(days);
    setFrom(isoDaysAgo(days));
    setTo(today());
  }

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading label="Statistika yuklanmoqda..." />;

  const summary = data.summary;
  const all = data.all_time;
  const finance = data.finance;
  const series = data.series || [];
  const maxSeries = Math.max(1, ...series.map((item) => Math.max(Number(item.total), Number(item.completed))));
  const totalRevenue = Number(summary.revenue_uzs) + Number(summary.revenue_usd);
  const completedRate = summary.work_total ? Math.round((summary.work_completed / summary.work_total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Statistika</h1>
          <p className="mt-1 text-sm text-white/50">Ishlar, tushum, navbatlar va xizmatlar kesimi.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 30, 90].map((days) => (
            <button key={days} type="button" onClick={() => pick(days)} className={`rounded-lg px-3 py-2 text-xs font-medium ${range === days ? 'bg-[rgb(var(--c-primary))] text-white' : 'border border-white/10 text-white/55 hover:bg-white/5'}`}>{days} kun</button>
          ))}
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3 !p-4">
        <div><label className="label">Boshlanish</label><input type="date" className="field" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setRange(0); }} /></div>
        <div><label className="label">Tugash</label><input type="date" className="field" value={to} min={from} onChange={(event) => { setTo(event.target.value); setRange(0); }} /></div>
        <button type="button" onClick={load} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5"><Icon name="refresh" size={16} className="mr-1 inline" /> Yangilash</button>
        <div className="ml-auto text-xs text-white/40">{data.range.date_from} — {data.range.date_to}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon="wrench" label="Jami ishlar" value={summary.work_total} hint={`${completedRate}% tugallangan`} />
        <Kpi icon="check" label="Tugallangan" value={summary.work_completed} hint={`${summary.work_in_progress} jarayonda · ${summary.work_waiting} kutmoqda`} />
        <Kpi icon="calendar" label="Bugungi navbat" value={summary.appointments_today} hint={`${summary.appointments} ta tanlangan davrda`} />
        <Kpi icon="user" label="Mijoz / avtomobil" value={`${summary.customers} / ${summary.vehicles}`} hint="Faol kartalar" />
      </div>

      {user.role === 'super_admin' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MoneyCard label="Tushum (tanlangan davr)" value={money(summary.revenue_uzs)} sub={summary.revenue_usd ? money(summary.revenue_usd, 'USD') : "Qo'shimcha USD yo'q"} tone="primary" />
          <MoneyCard label="Jami tushum" value={money(all.revenue_uzs)} sub={all.revenue_usd ? money(all.revenue_usd, 'USD') : `${all.work_completed} ta ish`} />
          <MoneyCard label="Mijoz qarzi" value={money(finance.debt_outstanding_uzs)} sub={finance.debt_outstanding_usd ? money(finance.debt_outstanding_usd, 'USD') : "Qarz yo'q"} tone="warn" />
          <MoneyCard label="Ta'minotchi qarzi" value={money(finance.expense_outstanding_uzs)} sub={finance.expense_outstanding_usd ? money(finance.expense_outstanding_usd, 'USD') : "Qarz yo'q"} tone="warn" />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold">Kunlik dinamika</h2>
            <div className="flex gap-3 text-[11px] text-white/45"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[rgb(var(--c-primary))]" />Jami</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />Tugallangan</span></div>
          </div>
          {series.length === 0 ? <p className="py-12 text-center text-sm text-white/40">Ma'lumot yo'q</p> : (
            <div className="flex h-44 items-end gap-1 overflow-hidden">
              {series.map((item) => (
                <div key={item.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${shortDay(item.date)}: ${item.total} ish, ${item.completed} tugallangan`}>
                  <div className="flex w-full items-end justify-center gap-[2px]">
                    <div className="w-1/2 rounded-t-sm bg-[rgb(var(--c-primary))]/80" style={{ height: `${Math.max(3, (Number(item.total) / maxSeries) * 140)}px` }} />
                    <div className="w-1/2 rounded-t-sm bg-emerald-400/70" style={{ height: `${Math.max(2, (Number(item.completed) / maxSeries) * 140)}px` }} />
                  </div>
                  {series.length <= 14 && <span className="text-[9px] text-white/30">{shortDay(item.date)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-bold">Navbatlar</h2>
          <div className="space-y-2 text-sm">
            {[
              ['Kutilayotgan', data.appointments.waiting, 'warn'],
              ['Tasdiqlangan', data.appointments.confirmed, 'primary'],
              ['Jarayonda', data.appointments.in_progress, 'primary'],
              ['Tugallangan', data.appointments.completed, 'success'],
              ['Bekor qilingan', data.appointments.cancelled, 'danger'],
            ].map(([label, value, kind]) => (
              <div key={label} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                <span className="text-white/55">{label}</span>
                <Badge kind={value ? kind : 'default'}>{value}</Badge>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-white/10 pt-3 text-xs text-white/40">
            O'rtacha chek: <span className="text-white/70">{money(summary.average_ticket_uzs)}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-bold">Xizmatlar kesimi</h2>
          {(data.services || []).length === 0 ? <p className="py-6 text-center text-sm text-white/40">Ma'lumot yo'q</p> : (
            <div className="space-y-2">
              {data.services.map((service) => {
                const max = Math.max(1, ...data.services.map((item) => Number(item.total)));
                return (
                  <div key={service.name}>
                    <div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate text-white/65">{service.name}</span><span className="shrink-0 text-white/40">{service.completed}/{service.total} · {money(service.revenue_uzs)}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-[rgb(var(--c-primary))]" style={{ width: `${Math.max(3, (Number(service.total) / max) * 100)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-bold">Ustalar kesimi</h2>
          {(data.masters || []).filter((master) => master.is_active || master.total > 0).length === 0 ? <p className="py-6 text-center text-sm text-white/40">Ma'lumot yo'q</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-white/10 text-white/35"><th className="py-2">Usta</th><th className="py-2 text-center">Jami</th><th className="py-2 text-center">Tugallangan</th><th className="py-2 text-right">Tushum</th></tr></thead>
                <tbody>
                  {data.masters.filter((master) => master.is_active || master.total > 0).map((master) => (
                    <tr key={master.id} className="border-b border-white/5">
                      <td className="max-w-[140px] truncate py-2 text-white/70">{master.full_name}</td>
                      <td className="py-2 text-center">{master.total}</td>
                      <td className="py-2 text-center text-emerald-300">{master.completed}</td>
                      <td className="py-2 text-right text-white/55">{money(master.revenue_uzs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-white/10 px-5 py-4"><h2 className="font-bold">So'nggi ishlar</h2></div>
        {(data.recent || []).length === 0 ? <p className="py-8 text-center text-sm text-white/40">Ishlar yo'q</p> : (
          <div className="divide-y divide-white/5">
            {data.recent.map((work) => (
              <div key={work.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1"><div className="truncate">{work.title}</div><div className="text-xs text-white/40">{work.customer_name || 'Mijozsiz'} · {work.master_name || 'Usta yo\'q'} · {work.service_type}</div></div>
                <Badge kind={work.status === 'Tugallangan' ? 'success' : work.status === 'Bekor qilingan' ? 'danger' : 'default'}>{work.status}</Badge>
                <span className="w-28 text-right text-xs text-white/55">{money(work.price, work.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalRevenue === 0 && <p className="text-center text-xs text-white/30">Tanlangan davrda tugallangan ish tushumi yo'q.</p>}
    </div>
  );
}

function Kpi({ icon, label, value, hint }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs text-white/45"><Icon name={icon} size={14} /> {label}</div>
      <div className="mt-2 text-2xl font-extrabold leading-none">{value ?? 0}</div>
      <div className="mt-1 text-[11px] text-white/35">{hint}</div>
    </div>
  );
}

function MoneyCard({ label, value, sub, tone = 'default' }) {
  return (
    <div className={`card p-4 ${tone === 'primary' ? 'border-[rgb(var(--c-primary))]/25 bg-[rgb(var(--c-primary))]/[0.06]' : ''}`}>
      <div className="text-xs text-white/45">{label}</div>
      <div className={`mt-2 text-xl font-extrabold ${tone === 'warn' ? 'text-amber-200' : ''}`}>{value}</div>
      <div className="mt-1 text-[11px] text-white/35">{sub}</div>
    </div>
  );
}
