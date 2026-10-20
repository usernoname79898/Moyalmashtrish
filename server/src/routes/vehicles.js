'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const crm = require('../crm');

const router = require('../asyncRoute').wrapRouter(express.Router());
router.use(auth.authenticate);

function validate(body, existing = {}) {
  const pick = (key) => (body[key] !== undefined ? body[key] : existing[key]);
  const brand = crm.text(pick('brand'), 'Avtomobil markasi', { max: 80 });
  const model = crm.text(pick('model'), 'Avtomobil modeli', { max: 80 });
  const plate_number = crm.text(pick('plate_number'), 'Davlat raqami', { max: 30 }).toUpperCase();
  const vin = crm.text(pick('vin'), 'VIN', { max: 40 }).toUpperCase();
  if (!brand && !model && !plate_number && !vin) {
    throw crm.badRequest('Marka, model, davlat raqami yoki VIN kiritilishi shart');
  }
  const yearRaw = pick('year');
  let year = null;
  if (yearRaw !== '' && yearRaw !== null && yearRaw !== undefined) {
    const n = Number(yearRaw);
    if (!Number.isInteger(n) || n < 1886 || n > 2200) throw crm.badRequest("Ishlab chiqarilgan yil noto'g'ri");
    year = n;
  }
  const customer_id = pick('customer_id') === '' ? null : crm.positiveId(pick('customer_id'));
  return {
    customer_id,
    brand,
    model,
    year,
    plate_number,
    vin,
    color: crm.text(pick('color'), 'Rang', { max: 40 }),
    notes: crm.text(pick('notes'), 'Izoh', { max: 2000 }),
  };
}

async function checkCustomer(id) {
  if (!id) return;
  const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').get(id);
  if (!customer) throw crm.badRequest('Mijoz topilmadi');
}

const FIELDS = `
  v.id, v.customer_id, v.brand, v.model, v.year, v.plate_number, v.vin, v.color,
  v.notes, v.is_active, v.created_at, v.updated_at,
  c.full_name AS customer_name, c.phone AS customer_phone,
  (SELECT COUNT(*)::int FROM work_logs w WHERE w.vehicle_id = v.id) AS work_count,
  (SELECT MAX(w.created_at) FROM work_logs w WHERE w.vehicle_id = v.id) AS last_visit`;

router.get('/', async (req, res) => {
  const conds = [];
  const params = [];
  const archived = String(req.query.archived || '') === '1';
  conds.push(archived ? 'v.is_active = 0' : 'v.is_active = 1');
  const customerId = crm.positiveId(req.query.customer_id);
  if (customerId) {
    conds.push('v.customer_id = ?');
    params.push(customerId);
  }
  const q = crm.text(req.query.q, 'q', { max: 120 });
  if (q) {
    const like = `%${q}%`;
    conds.push(`(v.brand ILIKE ? OR v.model ILIKE ? OR v.plate_number ILIKE ? OR v.vin ILIKE ? OR c.full_name ILIKE ? OR c.phone ILIKE ?)`);
    params.push(like, like, like, like, like, like);
  }
  const where = 'WHERE ' + conds.join(' AND ');
  const base = `SELECT ${FIELDS} FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id ${where}
                ORDER BY v.created_at DESC, v.id DESC`;
  const wantsPage = String(req.query.page || '').trim() !== '' || String(req.query.per_page || '').trim() !== '';
  if (!wantsPage) {
    return res.json({ vehicles: await db.prepare(base).all(params) });
  }
  const totalRow = await db
    .prepare(`SELECT COUNT(*)::int AS total FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id ${where}`)
    .get(params);
  const total = Number(totalRow.total) || 0;
  const perPage = Math.min(100, Math.max(1, Number.parseInt(req.query.per_page, 10) || 20));
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const vehicles = await db
    .prepare(`${base} LIMIT ? OFFSET ?`)
    .all([...params, perPage, (page - 1) * perPage]);
  res.json({ vehicles, pagination: { page, per_page: perPage, total, pages } });
});

router.get('/stats', async (req, res) => {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE is_active = 1)::int AS total,
         COUNT(*) FILTER (WHERE is_active = 0)::int AS archived,
         COUNT(*) FILTER (WHERE is_active = 1 AND customer_id IS NULL)::int AS without_customer
       FROM vehicles`
    )
    .get();
  res.json({ stats: row });
});

router.get('/:id', async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Avtomobil topilmadi' });
  const vehicle = await db.prepare(`SELECT ${FIELDS} FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id WHERE v.id = ?`).get(id);
  if (!vehicle) return res.status(404).json({ error: 'Avtomobil topilmadi' });
  const [worklogs, appointments] = await Promise.all([
    db
      .prepare(
        `SELECT w.id, w.title, w.service_type, w.status, w.payment_status, w.price, w.currency,
                w.start_date, w.created_at, u.full_name AS master_name
           FROM work_logs w LEFT JOIN users u ON u.id = w.master_id
          WHERE w.vehicle_id = ? ORDER BY w.created_at DESC, w.id DESC LIMIT 100`
      )
      .all(id),
    db
      .prepare(
        `SELECT id, service_type, scheduled_date, scheduled_time, status, work_log_id
           FROM appointments WHERE vehicle_id = ? ORDER BY scheduled_date DESC, scheduled_time DESC LIMIT 50`
      )
      .all(id),
  ]);
  res.json({ vehicle, worklogs, appointments });
});

router.post('/', async (req, res) => {
  const v = validate(req.body || {});
  await checkCustomer(v.customer_id);
  if (v.plate_number) {
    const dupe = await db
      .prepare('SELECT id FROM vehicles WHERE is_active = 1 AND upper(btrim(plate_number)) = ? LIMIT 1')
      .get(v.plate_number);
    if (dupe) return res.status(409).json({ error: 'Bu davlat raqamli avtomobil allaqachon mavjud', vehicle_id: dupe.id });
  }
  const vehicle = await db
    .prepare(
      `INSERT INTO vehicles (customer_id, brand, model, year, plate_number, vin, color, notes, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING *`
    )
    .one(v.customer_id, v.brand, v.model, v.year, v.plate_number, v.vin, v.color, v.notes);
  res.status(201).json({ vehicle });
});

router.put('/:id', async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Avtomobil topilmadi' });
  const existing = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Avtomobil topilmadi' });
  const v = validate(req.body || {}, existing);
  await checkCustomer(v.customer_id);
  if (v.plate_number) {
    const dupe = await db
      .prepare('SELECT id FROM vehicles WHERE id <> ? AND is_active = 1 AND upper(btrim(plate_number)) = ? LIMIT 1')
      .get(id, v.plate_number);
    if (dupe) return res.status(409).json({ error: 'Bu davlat raqamli avtomobil allaqachon mavjud', vehicle_id: dupe.id });
  }
  const vehicle = await db
    .prepare(
      `UPDATE vehicles SET customer_id = ?, brand = ?, model = ?, year = ?, plate_number = ?,
              vin = ?, color = ?, notes = ?, updated_at = app_now()
        WHERE id = ? RETURNING *`
    )
    .one(v.customer_id, v.brand, v.model, v.year, v.plate_number, v.vin, v.color, v.notes, id);
  res.json({ vehicle });
});

router.delete('/:id', auth.authorize('super_admin'), async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Avtomobil topilmadi' });
  const existing = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Avtomobil topilmadi' });
  await db.prepare('UPDATE vehicles SET is_active = 0, updated_at = app_now() WHERE id = ?').run(id);
  res.json({ ok: true, archived: true });
});

router.post('/:id/restore', auth.authorize('super_admin'), async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Avtomobil topilmadi' });
  const existing = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Avtomobil topilmadi' });
  const vehicle = await db
    .prepare('UPDATE vehicles SET is_active = 1, updated_at = app_now() WHERE id = ? RETURNING *')
    .one(id);
  res.json({ vehicle });
});

module.exports = router;
