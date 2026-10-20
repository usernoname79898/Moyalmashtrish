'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const crm = require('../crm');

const router = require('../asyncRoute').wrapRouter(express.Router());
router.use(auth.authenticate);

function isSA(user) {
  return !!user && user.role === 'super_admin';
}

function validDate(value, fallback) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw crm.badRequest("Sana noto'g'ri (YYYY-MM-DD)");
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw crm.badRequest("Sana noto'g'ri");
  }
  return text;
}

function dateRange(req) {
  const today = new Date().toISOString().slice(0, 10);
  const startDefault = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const date_to = validDate(req.query.date_to, today);
  const date_from = validDate(req.query.date_from, startDefault);
  if (date_from > date_to) throw crm.badRequest("Boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas");
  return { date_from, date_to };
}

router.get('/', async (req, res) => {
  const { date_from, date_to } = dateRange(req);

  const workParams = [date_from, date_to];
  const workConds = ['w.created_at::date >= ?::date', 'w.created_at::date <= ?::date'];
  if (!isSA(req.user)) {
    workConds.push('w.master_id = ?');
    workParams.push(req.user.id);
  }
  const workWhere = 'WHERE ' + workConds.join(' AND ');

  const summary = await db
    .prepare(
      `SELECT
         COUNT(*)::int AS work_total,
         COUNT(*) FILTER (WHERE w.status = 'Tugallangan')::int AS work_completed,
         COUNT(*) FILTER (WHERE w.status = 'Jarayonda')::int AS work_in_progress,
         COUNT(*) FILTER (WHERE w.status = 'Kutilayotgan')::int AS work_waiting,
         COUNT(*) FILTER (WHERE w.status = 'Bekor qilingan')::int AS work_cancelled,
         COALESCE(SUM(w.price) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'UZS'), 0)::numeric AS revenue_uzs,
         COALESCE(SUM(w.price) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'USD'), 0)::numeric AS revenue_usd,
         COALESCE(SUM(w.paid_amount) FILTER (WHERE w.currency = 'UZS'), 0)::numeric AS paid_uzs,
         COALESCE(SUM(GREATEST(w.price - w.paid_amount, 0)) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'UZS'), 0)::numeric AS outstanding_uzs,
         COALESCE(SUM(GREATEST(w.price - w.paid_amount, 0)) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'USD'), 0)::numeric AS outstanding_usd,
         COALESCE(AVG(w.price) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'UZS' AND w.price > 0), 0)::numeric AS average_ticket_uzs
       FROM work_logs w ${workWhere}`
    )
    .get(workParams);

  const allTime = await db
    .prepare(
      `SELECT
         COUNT(*)::int AS work_total,
         COUNT(*) FILTER (WHERE status = 'Tugallangan')::int AS work_completed,
         COALESCE(SUM(price) FILTER (WHERE status = 'Tugallangan' AND currency = 'UZS'), 0)::numeric AS revenue_uzs,
         COALESCE(SUM(price) FILTER (WHERE status = 'Tugallangan' AND currency = 'USD'), 0)::numeric AS revenue_usd
       FROM work_logs ${isSA(req.user) ? '' : 'WHERE master_id = ?'}`
    )
    .get(isSA(req.user) ? [] : [req.user.id]);

  const apptWhere = ["a.scheduled_date >= ?", "a.scheduled_date <= ?"];
  const apptParams = [date_from, date_to];
  if (!isSA(req.user)) {
    apptWhere.push('(a.master_id = ? OR a.master_id IS NULL)');
    apptParams.push(req.user.id);
  }
  const appointmentsToday = await db
    .prepare(
      `SELECT COUNT(*)::int AS total FROM appointments a
        WHERE a.scheduled_date = CURRENT_DATE ${isSA(req.user) ? '' : 'AND (a.master_id = ? OR a.master_id IS NULL)'}`
    )
    .get(isSA(req.user) ? [] : [req.user.id]);

  const appointments = await db
    .prepare(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE a.status = 'Kutilayotgan')::int AS waiting,
        COUNT(*) FILTER (WHERE a.status = 'Tasdiqlangan')::int AS confirmed,
        COUNT(*) FILTER (WHERE a.status = 'Jarayonda')::int AS in_progress,
        COUNT(*) FILTER (WHERE a.status = 'Tugallangan')::int AS completed,
        COUNT(*) FILTER (WHERE a.status = 'Bekor qilingan')::int AS cancelled
       FROM appointments a WHERE ${apptWhere.join(' AND ')}`
    )
    .get(apptParams);

  const customers = await db.prepare('SELECT COUNT(*)::int AS total FROM customers WHERE is_active = 1').get();
  const vehicles = await db.prepare('SELECT COUNT(*)::int AS total FROM vehicles WHERE is_active = 1').get();

  let finance = {
    debt_outstanding_uzs: 0,
    debt_outstanding_usd: 0,
    expense_outstanding_uzs: 0,
    expense_outstanding_usd: 0,
  };
  if (isSA(req.user)) {
    const [debts, expenses] = await Promise.all([
      db
        .prepare(
          `SELECT COALESCE(SUM(remaining_amount) FILTER (WHERE currency = 'UZS'), 0)::numeric AS uzs,
                  COALESCE(SUM(remaining_amount) FILTER (WHERE currency = 'USD'), 0)::numeric AS usd
             FROM debts WHERE deleted_at IS NULL`
        )
        .get(),
      db
        .prepare(
          `SELECT COALESCE(SUM(remaining_amount) FILTER (WHERE currency = 'UZS'), 0)::numeric AS uzs,
                  COALESCE(SUM(remaining_amount) FILTER (WHERE currency = 'USD'), 0)::numeric AS usd
             FROM expenses WHERE deleted_at IS NULL`
        )
        .get(),
    ]);
    finance = {
      debt_outstanding_uzs: debts.uzs,
      debt_outstanding_usd: debts.usd,
      expense_outstanding_uzs: expenses.uzs,
      expense_outstanding_usd: expenses.usd,
    };
  }

  const series = await db
    .prepare(
      `WITH days AS (
         SELECT generate_series(?::date, ?::date, interval '1 day')::date AS day
       )
       SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
         COUNT(w.id)::int AS total,
         COUNT(w.id) FILTER (WHERE w.status = 'Tugallangan')::int AS completed,
         COALESCE(SUM(w.price) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'UZS'), 0)::numeric AS revenue_uzs
       FROM days
       LEFT JOIN work_logs w ON w.created_at::date = days.day
         ${isSA(req.user) ? '' : 'AND w.master_id = ?'}
       GROUP BY days.day ORDER BY days.day ASC`
    )
    .all(isSA(req.user) ? [date_from, date_to] : [date_from, date_to, req.user.id]);

  const services = await db
    .prepare(
      `SELECT w.service_type AS name, COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE w.status = 'Tugallangan')::int AS completed,
         COALESCE(SUM(w.price) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'UZS'), 0)::numeric AS revenue_uzs
       FROM work_logs w ${workWhere}
       GROUP BY w.service_type ORDER BY total DESC, name ASC LIMIT 20`
    )
    .all(workParams);

  const masters = isSA(req.user)
    ? await db
        .prepare(
          `SELECT u.id, u.full_name, u.username, u.is_active,
             COUNT(w.id)::int AS total,
             COUNT(w.id) FILTER (WHERE w.status = 'Tugallangan')::int AS completed,
             COALESCE(SUM(w.price) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'UZS'), 0)::numeric AS revenue_uzs
           FROM users u
           LEFT JOIN work_logs w ON w.master_id = u.id AND w.created_at::date >= ?::date AND w.created_at::date <= ?::date
           WHERE u.role = 'master'
           GROUP BY u.id, u.full_name, u.username, u.is_active
           ORDER BY completed DESC, total DESC, u.full_name ASC`
        )
        .all([date_from, date_to])
    : [
        await db
          .prepare(
            `SELECT u.id, u.full_name, u.username, u.is_active,
               COUNT(w.id)::int AS total,
               COUNT(w.id) FILTER (WHERE w.status = 'Tugallangan')::int AS completed,
               COALESCE(SUM(w.price) FILTER (WHERE w.status = 'Tugallangan' AND w.currency = 'UZS'), 0)::numeric AS revenue_uzs
             FROM users u LEFT JOIN work_logs w ON w.master_id = u.id
               AND w.created_at::date >= ?::date AND w.created_at::date <= ?::date
             WHERE u.id = ? GROUP BY u.id, u.full_name, u.username, u.is_active`
          )
          .all([date_from, date_to, req.user.id]),
      ];

  const recent = await db
    .prepare(
      `SELECT w.id, w.title, w.customer_name, w.service_type, w.status, w.payment_status,
              w.price, w.currency, w.created_at, u.full_name AS master_name
         FROM work_logs w LEFT JOIN users u ON u.id = w.master_id
        ${isSA(req.user) ? '' : 'WHERE w.master_id = ?'}
        ORDER BY w.created_at DESC, w.id DESC LIMIT 8`
    )
    .all(isSA(req.user) ? [] : [req.user.id]);

  res.json({
    range: { date_from, date_to },
    summary: {
      ...summary,
      customers: customers.total,
      vehicles: vehicles.total,
      appointments: appointments.total,
      appointments_today: appointmentsToday.total,
    },
    all_time: allTime,
    appointments,
    finance,
    series,
    services,
    masters,
    recent,
  });
});

module.exports = router;
