'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const crm = require('../crm');

const router = require('../asyncRoute').wrapRouter(express.Router());
router.use(auth.authenticate);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body, existing = {}) {
  const merged = {
    full_name: body.full_name !== undefined ? body.full_name : existing.full_name,
    phone: body.phone !== undefined ? body.phone : existing.phone,
    email: body.email !== undefined ? body.email : existing.email,
    address: body.address !== undefined ? body.address : existing.address,
    notes: body.notes !== undefined ? body.notes : existing.notes,
  };
  const full_name = crm.text(merged.full_name, 'Mijoz ismi', { max: 150 });
  const phone = crm.text(merged.phone, 'Mijoz telefoni', { max: 40 });
  const email = crm.text(merged.email, 'Email', { max: 160 }).toLowerCase();
  if (!full_name && !phone) throw crm.badRequest('Mijoz ismi yoki telefoni kiritilishi shart');
  if (email && !EMAIL_RE.test(email)) throw crm.badRequest("Email noto'g'ri");
  return {
    full_name: full_name || phone,
    phone,
    email,
    address: crm.text(merged.address, 'Manzil', { max: 500 }),
    notes: crm.text(merged.notes, 'Izoh', { max: 2000 }),
  };
}

const LIST_FIELDS = `
  c.id, c.full_name, c.phone, c.email, c.address, c.notes, c.is_active,
  c.created_at, c.updated_at,
  (SELECT COUNT(*)::int FROM vehicles v WHERE v.customer_id = c.id AND v.is_active = 1) AS vehicle_count,
  (SELECT COUNT(*)::int FROM work_logs w WHERE w.customer_id = c.id) AS work_count,
  (SELECT MAX(w.created_at) FROM work_logs w WHERE w.customer_id = c.id) AS last_visit`;

router.get('/', async (req, res) => {
  const conds = [];
  const params = [];
  const archived = String(req.query.archived || '') === '1';
  conds.push(archived ? 'c.is_active = 0' : 'c.is_active = 1');
  const q = crm.text(req.query.q, 'q', { max: 120 });
  if (q) {
    const like = `%${q}%`;
    conds.push(`(
      c.full_name ILIKE ? OR c.phone ILIKE ? OR c.email ILIKE ? OR c.address ILIKE ?
      OR EXISTS (SELECT 1 FROM vehicles vq WHERE vq.customer_id = c.id AND (vq.plate_number ILIKE ? OR vq.vin ILIKE ?))
    )`);
    params.push(like, like, like, like, like, like);
  }
  const where = 'WHERE ' + conds.join(' AND ');
  const base = `SELECT ${LIST_FIELDS} FROM customers c ${where} ORDER BY c.full_name ASC, c.id ASC`;
  const wantsPage = String(req.query.page || '').trim() !== '' || String(req.query.per_page || '').trim() !== '';
  if (!wantsPage) {
    return res.json({ customers: await db.prepare(base).all(params) });
  }
  const totalRow = await db.prepare(`SELECT COUNT(*)::int AS total FROM customers c ${where}`).get(params);
  const total = Number(totalRow.total) || 0;
  const perPage = Math.min(100, Math.max(1, Number.parseInt(req.query.per_page, 10) || 20));
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const customers = await db
    .prepare(`${base} LIMIT ? OFFSET ?`)
    .all([...params, perPage, (page - 1) * perPage]);
  res.json({ customers, pagination: { page, per_page: perPage, total, pages } });
});

router.get('/stats', async (req, res) => {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE is_active = 1)::int AS total,
         COUNT(*) FILTER (WHERE is_active = 0)::int AS archived,
         COUNT(*) FILTER (WHERE is_active = 1 AND created_at >= to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))::int AS new_this_month
       FROM customers`
    )
    .get();
  const vehicles = await db.prepare('SELECT COUNT(*)::int AS total FROM vehicles WHERE is_active = 1').get();
  res.json({ stats: { ...row, vehicles: vehicles.total } });
});

router.get('/:id', async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Mijoz topilmadi' });
  const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) return res.status(404).json({ error: 'Mijoz topilmadi' });
  const [vehicles, worklogs, appointments] = await Promise.all([
    db.prepare('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY is_active DESC, created_at DESC, id DESC').all(id),
    db
      .prepare(
        `SELECT w.id, w.title, w.service_type, w.status, w.payment_status, w.price, w.currency,
                w.paid_amount, w.start_date, w.created_at, w.car_brand, w.car_model, w.car_number,
                u.full_name AS master_name
           FROM work_logs w LEFT JOIN users u ON u.id = w.master_id
          WHERE w.customer_id = ? ORDER BY w.created_at DESC, w.id DESC LIMIT 100`
      )
      .all(id),
    db
      .prepare(
        `SELECT a.id, a.service_type, a.scheduled_date, a.scheduled_time, a.status, a.work_log_id,
                u.full_name AS master_name
           FROM appointments a LEFT JOIN users u ON u.id = a.master_id
          WHERE a.customer_id = ? ORDER BY a.scheduled_date DESC, a.scheduled_time DESC LIMIT 50`
      )
      .all(id),
  ]);
  res.json({ customer, vehicles, worklogs, appointments });
});

router.post('/', async (req, res) => {
  const v = validate(req.body || {});
  const dupe = await db
    .prepare(
      `SELECT id FROM customers
        WHERE lower(btrim(full_name)) = lower(btrim(?))
          AND lower(btrim(phone)) = lower(btrim(?)) LIMIT 1`
    )
    .get(v.full_name, v.phone);
  if (dupe) return res.status(409).json({ error: 'Bu mijoz allaqachon mavjud', customer_id: dupe.id });
  const customer = await db
    .prepare(
      `INSERT INTO customers (full_name, phone, email, address, notes, is_active)
       VALUES (?, ?, ?, ?, ?, 1) RETURNING *`
    )
    .one(v.full_name, v.phone, v.email, v.address, v.notes);
  res.status(201).json({ customer });
});

router.put('/:id', async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Mijoz topilmadi' });
  const existing = await db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Mijoz topilmadi' });
  const v = validate(req.body || {}, existing);
  const dupe = await db
    .prepare(
      `SELECT id FROM customers
        WHERE id <> ?
          AND lower(btrim(full_name)) = lower(btrim(?))
          AND lower(btrim(phone)) = lower(btrim(?)) LIMIT 1`
    )
    .get(id, v.full_name, v.phone);
  if (dupe) return res.status(409).json({ error: 'Bu mijoz allaqachon mavjud', customer_id: dupe.id });
  const customer = await db
    .prepare(
      `UPDATE customers SET full_name = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = app_now()
       WHERE id = ? RETURNING *`
    )
    .one(v.full_name, v.phone, v.email, v.address, v.notes, id);
  res.json({ customer });
});

router.delete('/:id', auth.authorize('super_admin'), async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Mijoz topilmadi' });
  const existing = await db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Mijoz topilmadi' });
  await db
    .prepare('UPDATE customers SET is_active = 0, updated_at = app_now() WHERE id = ?')
    .run(id);
  res.json({ ok: true, archived: true });
});

router.post('/:id/restore', auth.authorize('super_admin'), async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Mijoz topilmadi' });
  const existing = await db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Mijoz topilmadi' });
  const customer = await db
    .prepare('UPDATE customers SET is_active = 1, updated_at = app_now() WHERE id = ? RETURNING *')
    .one(id);
  res.json({ customer });
});

module.exports = router;
