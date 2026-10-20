'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const crm = require('../crm');
const { normalizeCurrency } = require('../currency');

const router = require('../asyncRoute').wrapRouter(express.Router());
router.use(auth.authenticate);

const STATUSES = ['Kutilayotgan', 'Tasdiqlangan', 'Jarayonda', 'Tugallangan', 'Bekor qilingan'];
const TRANSITIONS = {
  Kutilayotgan: ['Tasdiqlangan', 'Bekor qilingan'],
  Tasdiqlangan: ['Jarayonda', 'Bekor qilingan'],
  Jarayonda: ['Tugallangan', 'Bekor qilingan'],
  Tugallangan: [],
  'Bekor qilingan': [],
};

function isSA(user) {
  return !!user && user.role === 'super_admin';
}

function validateDate(value) {
  const date = String(value == null ? '' : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw crm.badRequest("Sana noto'g'ri (YYYY-MM-DD)");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw crm.badRequest("Sana noto'g'ri");
  }
  return date;
}

function validateTime(value) {
  const time = String(value == null ? '' : value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw crm.badRequest("Vaqt noto'g'ri (HH:MM)");
  return time;
}

async function activeService(value, previous) {
  const wanted = String(value == null ? '' : value).trim();
  if (previous && wanted === previous) return previous;
  const rows = await db.prepare('SELECT name, is_active FROM services ORDER BY sort_order ASC, id ASC').all();
  const norm = (v) => String(v).replace(/\s+/g, ' ').toLowerCase();
  const matches = rows.filter((r) => norm(r.name) === norm(wanted));
  const live = [...new Set(matches.filter((r) => Number(r.is_active) === 1).map((r) => r.name))];
  if (live.length === 1) return live[0];
  const retired = [...new Set(matches.map((r) => r.name))];
  if (retired.length === 1) throw crm.badRequest(`Xizmat turi faol emas: "${retired[0]}"`);
  throw crm.badRequest("Xizmat turi noto'g'ri");
}

async function checkMaster(id) {
  if (!id) return null;
  const master = await db
    .prepare("SELECT id FROM users WHERE id = ? AND role = 'master' AND is_active = 1")
    .get(id);
  if (!master) throw crm.badRequest("Usta topilmadi yoki faol emas");
  return id;
}

function validate(body, existing = {}) {
  const pick = (key) => (body[key] !== undefined ? body[key] : existing[key]);
  const service_type = String(pick('service_type') == null ? '' : pick('service_type')).trim();
  if (!service_type) throw crm.badRequest("Xizmat turi tanlanishi shart");
  const scheduled_date = validateDate(pick('scheduled_date'));
  const scheduled_time = validateTime(pick('scheduled_time'));
  const masterRaw = pick('master_id');
  const master_id = masterRaw === '' || masterRaw == null ? null : crm.positiveId(masterRaw);
  if (masterRaw !== '' && masterRaw != null && !master_id) throw crm.badRequest("Usta noto'g'ri");
  return {
    customer_id: pick('customer_id') === '' ? null : crm.positiveId(pick('customer_id')),
    vehicle_id: pick('vehicle_id') === '' ? null : crm.positiveId(pick('vehicle_id')),
    customer_name: crm.text(pick('customer_name'), 'Mijoz ismi', { max: 150 }),
    customer_phone: crm.text(pick('customer_phone'), 'Mijoz telefoni', { max: 40 }),
    car_brand: crm.text(pick('car_brand'), 'Avtomobil markasi', { max: 80 }),
    car_model: crm.text(pick('car_model'), 'Avtomobil modeli', { max: 80 }),
    car_number: crm.text(pick('car_number'), 'Davlat raqami', { max: 30 }),
    service_type,
    scheduled_date,
    scheduled_time,
    master_id,
    notes: crm.text(pick('notes'), 'Izoh', { max: 2000 }),
  };
}

async function resolveRelations(v, previous = {}) {
  let customer = null;
  if (v.customer_id) {
    customer = await crm.findCustomer(db, v.customer_id);
    if (!customer) throw crm.badRequest('Mijoz topilmadi');
  }
  let vehicle = null;
  if (v.vehicle_id) {
    vehicle = await crm.findVehicle(db, v.vehicle_id);
    if (!vehicle) throw crm.badRequest('Avtomobil topilmadi');
    if (customer && vehicle.customer_id && vehicle.customer_id !== customer.id) {
      throw crm.badRequest("Avtomobil boshqa mijozga tegishli");
    }
    if (!customer && vehicle.customer_id) {
      customer = await crm.findCustomer(db, vehicle.customer_id);
    }
  }
  if (!customer && (v.customer_name || v.customer_phone)) {
    customer = await crm.findOrCreateCustomer(db, {
      full_name: v.customer_name,
      phone: v.customer_phone,
    });
  }
  if (!vehicle && customer && (v.car_brand || v.car_model || v.car_number)) {
    vehicle = await crm.findOrCreateVehicle(db, {
      brand: v.car_brand,
      model: v.car_model,
      plate_number: v.car_number,
    }, customer.id);
  }
  const snapshots = {
    ...(customer ? crm.customerSnapshot(customer) : {}),
    ...(vehicle ? crm.vehicleSnapshot(vehicle) : {}),
  };
  return {
    customer,
    vehicle,
    customer_id: customer ? customer.id : null,
    vehicle_id: vehicle ? vehicle.id : null,
    customer_name: snapshots.customer_name !== undefined ? snapshots.customer_name : v.customer_name,
    customer_phone: snapshots.customer_phone !== undefined ? snapshots.customer_phone : v.customer_phone,
    car_brand: snapshots.car_brand !== undefined ? snapshots.car_brand : v.car_brand,
    car_model: snapshots.car_model !== undefined ? snapshots.car_model : v.car_model,
    car_number: snapshots.car_number !== undefined ? snapshots.car_number : v.car_number,
  };
}

function canAccess(req, appointment) {
  if (isSA(req.user)) return true;
  return !appointment.master_id || appointment.master_id === req.user.id;
}

const FIELDS = `
  a.id, a.customer_id, a.vehicle_id, a.customer_name, a.customer_phone, a.car_brand, a.car_model,
  a.car_number, a.service_type, a.scheduled_date, a.scheduled_time, a.master_id, a.status,
  a.notes, a.source, a.work_log_id, a.created_by, a.created_at, a.updated_at,
  u.full_name AS master_name, c.email AS customer_email,
  w.title AS work_title, w.status AS work_status`;

router.get('/', async (req, res) => {
  const conds = [];
  const params = [];
  if (!isSA(req.user)) {
    conds.push('(a.master_id = ? OR a.master_id IS NULL)');
    params.push(req.user.id);
  } else {
    const masterId = crm.positiveId(req.query.master_id);
    if (masterId) {
      conds.push('a.master_id = ?');
      params.push(masterId);
    }
  }
  const status = String(req.query.status || '').trim();
  if (STATUSES.includes(status)) {
    conds.push('a.status = ?');
    params.push(status);
  }
  if (String(req.query.date_from || '').trim()) {
    conds.push('a.scheduled_date >= ?');
    params.push(validateDate(req.query.date_from));
  }
  if (String(req.query.date_to || '').trim()) {
    conds.push('a.scheduled_date <= ?');
    params.push(validateDate(req.query.date_to));
  }
  const q = crm.text(req.query.q, 'q', { max: 120 });
  if (q) {
    const like = `%${q}%`;
    conds.push(`(a.customer_name ILIKE ? OR a.customer_phone ILIKE ? OR a.car_brand ILIKE ?
      OR a.car_model ILIKE ? OR a.car_number ILIKE ? OR a.service_type ILIKE ? OR CAST(a.id AS TEXT) ILIKE ?)`);
    params.push(like, like, like, like, like, like, like);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const base = `SELECT ${FIELDS} FROM appointments a
    LEFT JOIN users u ON u.id = a.master_id
    LEFT JOIN customers c ON c.id = a.customer_id
    LEFT JOIN work_logs w ON w.id = a.work_log_id
    ${where} ORDER BY a.scheduled_date ASC, a.scheduled_time ASC, a.id ASC`;
  const wantsPage = String(req.query.page || '').trim() !== '' || String(req.query.per_page || '').trim() !== '';
  if (!wantsPage) return res.json({ appointments: await db.prepare(base).all(params) });
  const totalRow = await db.prepare(`SELECT COUNT(*)::int AS total FROM appointments a ${where}`).get(params);
  const total = Number(totalRow.total) || 0;
  const perPage = Math.min(100, Math.max(1, Number.parseInt(req.query.per_page, 10) || 20));
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const appointments = await db
    .prepare(`${base} LIMIT ? OFFSET ?`)
    .all([...params, perPage, (page - 1) * perPage]);
  res.json({ appointments, pagination: { page, per_page: perPage, total, pages } });
});

router.get('/stats', async (req, res) => {
  const params = [];
  let where = '';
  if (!isSA(req.user)) {
    where = 'WHERE (master_id = ? OR master_id IS NULL)';
    params.push(req.user.id);
  }
  const row = await db
    .prepare(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'Kutilayotgan')::int AS waiting,
        COUNT(*) FILTER (WHERE status = 'Tasdiqlangan')::int AS confirmed,
        COUNT(*) FILTER (WHERE status = 'Jarayonda')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'Tugallangan')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'Bekor qilingan')::int AS cancelled,
        COUNT(*) FILTER (WHERE scheduled_date = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'))::int AS today
       FROM appointments ${where}`
    )
    .get(params);
  res.json({
    stats: {
      total: row.total,
      waiting: row.waiting,
      confirmed: row.confirmed,
      inProgress: row.in_progress,
      completed: row.completed,
      cancelled: row.cancelled,
      today: row.today,
    },
  });
});

router.get('/:id', async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Navbat topilmadi' });
  const appointment = await db.prepare(`SELECT ${FIELDS} FROM appointments a
    LEFT JOIN users u ON u.id = a.master_id
    LEFT JOIN customers c ON c.id = a.customer_id
    LEFT JOIN work_logs w ON w.id = a.work_log_id
    WHERE a.id = ?`).get(id);
  if (!appointment) return res.status(404).json({ error: 'Navbat topilmadi' });
  if (!canAccess(req, appointment)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  res.json({ appointment });
});

router.post('/', async (req, res) => {
  const v = validate(req.body || {});
  v.service_type = await activeService(v.service_type);
  await checkMaster(v.master_id);
  const rel = await resolveRelations(v);
  if (!rel.customer_name && !rel.customer_phone) {
    throw crm.badRequest('Mijoz ismi yoki telefoni kiritilishi shart');
  }
  if (!isSA(req.user)) {
    if (v.master_id && v.master_id !== req.user.id) {
      return res.status(403).json({ error: 'Faqat o\'zingizga navbat qo\'shishingiz mumkin' });
    }
    v.master_id = req.user.id;
  }
  const appointment = await db
    .prepare(
      `INSERT INTO appointments
        (customer_id, vehicle_id, customer_name, customer_phone, car_brand, car_model, car_number,
         service_type, scheduled_date, scheduled_time, master_id, status, notes, source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Kutilayotgan', ?, 'admin', ?)
       RETURNING *`
    )
    .one(
      rel.customer_id, rel.vehicle_id, rel.customer_name, rel.customer_phone,
      rel.car_brand, rel.car_model, rel.car_number, v.service_type,
      v.scheduled_date, v.scheduled_time, v.master_id, v.notes, req.user.id
    );
  res.status(201).json({ appointment });
});

router.put('/:id', async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Navbat topilmadi' });
  const existing = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Navbat topilmadi' });
  if (!canAccess(req, existing)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  const v = validate(req.body || {}, existing);
  v.service_type = await activeService(v.service_type, existing.service_type);
  await checkMaster(v.master_id);
  if (!isSA(req.user) && v.master_id && v.master_id !== req.user.id) {
    return res.status(403).json({ error: 'Navbatni boshqa ustaga biriktirib bo\'lmaydi' });
  }
  const rel = await resolveRelations(v, existing);
  const appointment = await db
    .prepare(
      `UPDATE appointments SET customer_id = ?, vehicle_id = ?, customer_name = ?, customer_phone = ?,
        car_brand = ?, car_model = ?, car_number = ?, service_type = ?, scheduled_date = ?,
        scheduled_time = ?, master_id = ?, notes = ?, updated_at = app_now()
       WHERE id = ? RETURNING *`
    )
    .one(
      rel.customer_id, rel.vehicle_id, rel.customer_name, rel.customer_phone,
      rel.car_brand, rel.car_model, rel.car_number, v.service_type,
      v.scheduled_date, v.scheduled_time, isSA(req.user) ? v.master_id : req.user.id,
      v.notes, id
    );
  res.json({ appointment });
});

router.patch('/:id/status', async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Navbat topilmadi' });
  const appointment = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) return res.status(404).json({ error: 'Navbat topilmadi' });
  if (!canAccess(req, appointment)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  const next = String((req.body && req.body.status) || '').trim();
  if (!STATUSES.includes(next)) return res.status(400).json({ error: "Navbat holati noto'g'ri" });
  if (next === appointment.status) {
    return res.status(409).json({ error: `Navbat allaqachon "${appointment.status}" holatida` });
  }
  const allowed = TRANSITIONS[appointment.status] || [];
  if (!allowed.includes(next)) {
    return res.status(409).json({ error: `"${appointment.status}" holatidan "${next}" holatiga o'tib bo'lmaydi` });
  }
  const updated = await db
    .prepare('UPDATE appointments SET status = ?, updated_at = app_now() WHERE id = ? RETURNING *')
    .one(next, id);
  if (appointment.work_log_id) {
    const workNext = next === 'Tugallangan' ? 'Tugallangan' : next === 'Jarayonda' ? 'Jarayonda' : null;
    if (workNext) {
      await db
        .prepare("UPDATE work_logs SET status = ?, updated_at = app_now() WHERE id = ? AND status IN ('Kutilayotgan', 'Jarayonda')")
        .run(workNext, appointment.work_log_id);
    }
  }
  res.json({ appointment: updated });
});

router.delete('/:id', auth.authorize('super_admin'), async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Navbat topilmadi' });
  const appointment = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) return res.status(404).json({ error: 'Navbat topilmadi' });
  if (appointment.status === 'Tugallangan') {
    return res.status(409).json({ error: "Tugallangan navbatni bekor qilib bo'lmaydi" });
  }
  const updated = await db
    .prepare("UPDATE appointments SET status = 'Bekor qilingan', updated_at = app_now() WHERE id = ? RETURNING *")
    .one(id);
  res.json({ appointment: updated, cancelled: true });
});

router.post('/:id/convert', async (req, res) => {
  const id = crm.positiveId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Navbat topilmadi' });
  const appointment = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appointment) return res.status(404).json({ error: 'Navbat topilmadi' });
  if (!canAccess(req, appointment)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  if (appointment.work_log_id) {
    return res.status(409).json({ error: 'Bu navbat allaqachon ishga aylantirilgan', work_log_id: appointment.work_log_id });
  }
  if (!['Kutilayotgan', 'Tasdiqlangan'].includes(appointment.status)) {
    return res.status(409).json({ error: "Faqat kutilayotgan yoki tasdiqlangan navbat ishga aylantiriladi" });
  }

  const body = req.body || {};
  const masterRaw = body.master_id === undefined ? appointment.master_id : body.master_id;
  const master_id = masterRaw === '' || masterRaw == null ? null : crm.positiveId(masterRaw);
  if (!master_id) {
    if (!isSA(req.user)) {
      return res.status(400).json({ error: 'Ish bajaruvchi ustani tanlang' });
    }
    return res.status(400).json({ error: 'Ish bajaruvchi ustani tanlang' });
  }
  if (!isSA(req.user) && master_id !== req.user.id) {
    return res.status(403).json({ error: 'Ish faqat o\'zingizga biriktirilishi mumkin' });
  }
  await checkMaster(master_id);

  const title = crm.text(body.title, 'Ish nomi', { max: 200 }) || `${appointment.service_type} — ${appointment.customer_name || 'Mijoz'}`;
  let price = 0;
  if (body.price !== undefined && body.price !== null && body.price !== '') {
    price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 1e12) throw crm.badRequest("Narx noto'g'ri");
  }
  let currency;
  try {
    currency = normalizeCurrency(body.currency);
  } catch (err) {
    throw crm.badRequest(err.message);
  }

  const work = await db.transaction(async (t) => {
    const locked = await t.prepare('SELECT * FROM appointments WHERE id = ? FOR UPDATE').get(id);
    if (!locked) throw crm.badRequest('Navbat topilmadi');
    if (locked.work_log_id) {
      const err = new Error('Bu navbat allaqachon ishga aylantirilgan');
      err.status = 409;
      throw err;
    }
    const row = await t
      .prepare(
        `INSERT INTO work_logs
          (master_id, customer_id, vehicle_id, appointment_id, title, customer_name, customer_phone,
           car_brand, car_model, car_number, service_type, description, diagnosis, start_date, end_date,
           scheduled_time, price, currency, status, payment_status, notes, is_public, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'Kutilayotgan', 'unpaid', ?, 0, ?)
         RETURNING id`
      )
      .one(
        master_id, appointment.customer_id, appointment.vehicle_id, appointment.id, title,
        appointment.customer_name, appointment.customer_phone, appointment.car_brand,
        appointment.car_model, appointment.car_number, appointment.service_type,
        crm.text(body.description, 'Tavsif', { max: 5000 }),
        crm.text(body.diagnosis, 'Tashxis', { max: 5000 }),
        appointment.scheduled_date, appointment.scheduled_time, price, currency,
        crm.text(body.notes, 'Izoh', { max: 2000 }), req.user.id
      );
    await t
      .prepare(
        `INSERT INTO work_log_status_history (work_log_id, from_status, to_status, admin_id, admin_name, note)
         VALUES (?, '', 'Kutilayotgan', ?, ?, 'Navbatdan ish yaratildi')`
      )
      .run(row.id, req.user.id, req.user.full_name || '');
    await t
      .prepare("UPDATE appointments SET status = 'Tasdiqlangan', work_log_id = ?, master_id = ?, updated_at = app_now() WHERE id = ?")
      .run(row.id, master_id, appointment.id);
    return row;
  });

  res.status(201).json({
    work: await db.prepare('SELECT * FROM work_logs WHERE id = ?').get(work.id),
    appointment: await db.prepare('SELECT * FROM appointments WHERE id = ?').get(id),
  });
});

module.exports = router;
