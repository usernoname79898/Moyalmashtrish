const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../db');
const auth = require('../auth');
const storage = require('../storage');
const inv = require('../inventory');
const crm = require('../crm');
const { normalizeCurrency } = require('../currency');

const router = require('../asyncRoute').wrapRouter(express.Router());
router.use(auth.authenticate);

const WORK_DIR = require('../paths').workDir;
// The catalogue offered when filing work is the `services` table itself -- the
// same rows /admin/services edits -- so a service the admin adds there is
// fileable here immediately, and one the admin retires stops being offered. It
// is read on demand and never mirrored into a constant: a static list would
// quietly reject the shop's own ninth service.
// The retired combined label from the previous mechanical catalogue. It is kept
// only so old records still render and remain editable.
const LEGACY_SERVICE_TYPE = 'Mator xodovoy';
const STATUSES = ['Kutilayotgan', 'Jarayonda', 'Tugallangan', 'Bekor qilingan'];
const STATUS_TRANSITIONS = {
  Kutilayotgan: ['Jarayonda', 'Bekor qilingan'],
  Jarayonda: ['Tugallangan', 'Bekor qilingan'],
  Tugallangan: [],
  'Bekor qilingan': [],
};
const MAX_WORK_IMAGES = 15;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const WORK_LIST_FIELDS = `
  w.id, w.master_id, w.customer_id, w.vehicle_id, w.appointment_id, w.title, w.customer_name,
  w.customer_phone, w.car_brand, w.car_model, w.car_number, w.service_type, w.description,
  w.diagnosis, w.start_date, w.end_date, w.scheduled_time, w.parts_cost, w.labor_cost,
  w.price, w.currency, w.status, w.payment_status, w.paid_amount, w.payment_method,
  w.completed_at, w.created_by, w.is_public, w.notes, w.created_at, w.updated_at,
  u.full_name AS master_name`;

const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid'];

function ensureWorkDir() {
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
}

function isSA(user) {
  return !!user && user.role === 'super_admin';
}

function toFlag(value) {
  return Number(value) ? 1 : 0;
}

async function loadWork(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id)) return null;
  return db
    .prepare(`SELECT ${WORK_LIST_FIELDS} FROM work_logs w LEFT JOIN users u ON u.id = w.master_id WHERE w.id = ?`)
    .get(id);
}

function canAccess(req, work) {
  if (!work) return false;
  if (isSA(req.user)) return true;
  return work.master_id === req.user.id;
}

async function imagesFor(workId) {
  return db
    .prepare('SELECT id, image_path, original_filename FROM work_log_images WHERE work_log_id = ? ORDER BY id ASC')
    .all(workId);
}

/**
 * Oil and filters consumed by a work, for every id in the batch.
 *
 * One query for the whole page rather than one per work log: the list endpoint
 * is unpaginated, so an N+1 here would mean a query per row on every refresh.
 */
async function materialsFor(workIds) {
  const ids = Array.from(new Set(workIds.filter((n) => Number.isInteger(n))));
  if (!ids.length) return new Map();
  const rows = await db
    .prepare(
      `SELECT sm.work_log_id, sm.id, sm.product_id, sm.quantity, sm.movement_id,
              p.name AS product_name, p.type AS product_type, p.brand, p.viscosity, p.unit
         FROM service_materials sm JOIN inventory_products p ON p.id = sm.product_id
        WHERE sm.work_log_id = ANY(?::int[]) ORDER BY sm.id ASC`
    )
    .all([ids]);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.work_log_id)) map.set(row.work_log_id, []);
    map.get(row.work_log_id).push(row);
  }
  return map;
}

/**
 * Validates the `materials` array of a work-log request.
 *
 * Shape is `[{ product_id, quantity }]`. An empty or absent array is valid and
 * means "this job consumed nothing from the warehouse", so every existing caller
 * that sends no materials keeps working unchanged.
 *
 * Only the shape is checked here. Whether the stock is *sufficient* is decided
 * later, inside the transaction, once the row lock is held -- checking earlier
 * would be a time-of-check-to-time-of-use race against any other admin.
 */
function validateMaterials(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw inv.badRequest(' materiallar ro\'yxati bo\'lishi kerak');
  if (raw.length > 30) throw inv.badRequest('Bir ishga 30 tadan ko\'p material kiritib bo\'lmaydi');
  return raw.map((m, i) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      throw inv.badRequest(`${i + 1}-material noto'g'ri formatda`);
    }
    const productId = Number(m.product_id);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw inv.badRequest(`${i + 1}-material uchun mahsulot tanlanmagan`);
    }
    const quantity = inv.parseQty(m.quantity, `${i + 1}-material miqdori`, { allowZero: true });
    if (quantity <= 0) throw inv.badRequest(`${i + 1}-material miqdori 0 dan katta bo'lishi kerak`);
    return {
      product_id: productId,
      quantity,
      note: inv.text(m.note, `${i + 1}-material izohi`, { max: 200 }),
    };
  });
}

/**
 * Consumes every listed material inside the caller's transaction.
 *
 * The work log row and every stock movement land in the same transaction, so the
 * warehouse can never record oil leaving for a job that does not exist, and a
 * job can never exist with oil that never left. If the third product is short,
 * the first two are rolled back with everything else.
 *
 * MUST be called inside db.transaction().
 */
async function consumeMaterials(t, req, workLogId, materials) {
  for (const m of materials) {
    // applyMovement locks the product row FOR UPDATE, checks sufficiency and
    // writes the movement -- all on this transaction's connection.
    const { movement } = await inv.applyMovement(t, {
      productId: m.product_id,
      movementType: 'consumption',
      quantity: m.quantity,
      req,
      note: m.note || 'Ishda ishlatildi',
      referenceType: 'work_log',
      referenceId: workLogId,
    });
    await t
      .prepare(
        'INSERT INTO service_materials (work_log_id, product_id, quantity, movement_id) VALUES (?, ?, ?, ?)'
      )
      .run(workLogId, m.product_id, m.quantity, movement.id);
  }
  return materials.length;
}

async function decorate(row) {
  if (!row) return null;
  const w = {
    ...row,
    is_public: row.is_public ? 1 : 0,
    price: Number(row.price) || 0,
    parts_cost: Number(row.parts_cost) || 0,
    labor_cost: Number(row.labor_cost) || 0,
    paid_amount: Number(row.paid_amount) || 0,
  };
  w.images = await imagesFor(w.id);
  return w;
}

async function statusHistoryFor(workId) {
  return db
    .prepare(
      `SELECT id, from_status, to_status, admin_id, admin_name, note, created_at
         FROM work_log_status_history WHERE work_log_id = ? ORDER BY created_at ASC, id ASC`
    )
    .all(workId);
}

const SANITIZE = /[^a-zA-Z0-9._-]/g;
function uniqueWorkFilename(original) {
  const ext = path.extname(original || '').toLowerCase();
  const base = path.basename(original || 'work', ext).replace(SANITIZE, '-').slice(0, 40) || 'work';
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}${ext}`;
}

// With R2 configured the bytes go straight from memory to the bucket: no
// temporary file is created at all, which is what makes uploads work on a
// serverless host whose filesystem is read-only. The local-disk path is kept
// only for development without R2.
const workUpload = multer({
  storage: storage.enabled
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (req, file, cb) => {
          ensureWorkDir();
          cb(null, WORK_DIR);
        },
        filename: (req, file, cb) => cb(null, uniqueWorkFilename(file.originalname)),
      }),
  limits: { fileSize: MAX_IMAGE_SIZE, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!storage.isValidMime(file.mimetype)) {
      const err = new Error('Faqat JPG, JPEG, PNG, WEBP, AVIF ruxsat etiladi');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

/**
 * The whole catalogue, active or not, in the order the shop offers it.
 *
 * Inactive rows are read as well as active ones so the refusal can name the
 * service that exists but is switched off, instead of a flat "not a valid
 * service type" that sends the operator hunting for a typo they did not make.
 * Never cached: the admin panel is the source of truth, and a stale copy would
 * keep accepting a service the shop has retired.
 */
async function serviceTypeCatalog() {
  const rows = await db
    .prepare('SELECT name, is_active FROM services ORDER BY sort_order ASC, id ASC')
    .all();
  return rows.map((row) => ({ name: String(row.name), active: Number(row.is_active) === 1 }));
}

/**
 * Resolves what the operator sent to the catalogue row it stands for.
 *
 * The dropdown sends the stored spelling verbatim, so the exact match is the
 * normal path. The case- and space-insensitive pass after it exists for a value
 * typed or pasted by hand: "elektrodiagnostika" must not be refused while the
 * shop plainly offers "Elektrodiagnostika". Whichever row wins, its own spelling
 * is what comes back, so
 * `work_logs.service_type` and `services.name` stay byte-identical and a later
 * rename of the service cannot silently fork the two.
 *
 * @returns {{ name: string }} an active service, ready to store
 *   | { inactive: string } the service exists but is switched off
 *   | { unknown: true } nothing in the catalogue matches (or two rows match
 *     differently, which would make picking one arbitrary)
 */
function resolveServiceType(catalog, raw) {
  const wanted = String(raw == null ? '' : raw).trim();
  if (!wanted) return { unknown: true };
  const norm = (v) => v.replace(/\s+/g, ' ').toLowerCase();
  const wantedNorm = norm(wanted);
  const matches = catalog.filter((s) => s.name === wanted || norm(s.name) === wantedNorm);
  // An active row always wins over a retired one with the same name, so a
  // duplicate left behind by the admin cannot hide a service that is live.
  const live = [...new Set(matches.filter((s) => s.active).map((s) => s.name))];
  if (live.length === 1) return { name: live[0] };
  if (live.length > 1) return { unknown: true };
  const retired = [...new Set(matches.map((s) => s.name))];
  return retired.length === 1 ? { inactive: retired[0] } : { unknown: true };
}

/**
 * @param {object} b request body
 * @param {string} [previousServiceType] value already stored on the row, for the
 *   PUT path. It lets a log filed under a since-retired service keep being edited
 *   without being reclassified; it never lets a NEW value through.
 * @param {{ name: string, active: boolean }[]} catalog as returned by
 *   serviceTypeCatalog(); loaded once per request by the caller rather than
 *   inside the pure check, so this function stays testable on its own
 * @param {object} [existing] the row being edited, for the PUT path. A field the
 *   body does not mention keeps the value already stored on it, so an edit that
 *   did not touch it never quietly rewrites it.
 * @returns the cleaned body, or `{ error }`
 */
function validateWorkBody(b, previousServiceType, catalog, existing) {
  const has = (key) => Object.prototype.hasOwnProperty.call(b, key);
  const service_type = String(b.service_type || '').trim();
  const status = String(b.status || 'Jarayonda').trim();
  const scheduledTime = String(b.scheduled_time || '').trim();
  // The form carries no job price of its own: the amount that was paid is the
  // price of the job. A price that IS sent (an older API client) still wins, so
  // `price_sent` tells the caller which of the two it is looking at.
  const priceSent = b.price !== undefined && b.price !== null && b.price !== '';
  const price = Number(priceSent ? b.price : 0);
  const title = String(b.title || '').trim();
  if (!title) return { error: 'Ish nomi kiritilishi shart' };
  if (title.length > 200) return { error: 'Ish nomi juda uzun' };
  // An unchanged service_type is always accepted -- including the retired
  // legacy label -- so editing the price or status of an old log does not force
  // the master to re-classify work they did not touch. Anything that does change
  // has to be a service the shop offers today, which is what stops a retired name
  // from being written again. The stored value is the catalogue's own spelling.
  let canonicalType = service_type;
  if (service_type !== previousServiceType) {
    const resolved = resolveServiceType(catalog, service_type);
    if (resolved.name) {
      canonicalType = resolved.name;
    } else if (service_type === LEGACY_SERVICE_TYPE) {
      return {
        error:
          `Xizmat turi noto'g'ri: "${LEGACY_SERVICE_TYPE}" eski katalogdan qolgan va endi ishlatilmaydi. Katalogdan xizmatni tanlang.`,
      };
    } else if (resolved.inactive) {
      return { error: `Xizmat turi faol emas: "${resolved.inactive}"` };
    } else {
      return { error: "Xizmat turi noto'g'ri" };
    }
  }
  if (!STATUSES.includes(status)) return { error: 'Ish holati noto\'g\'ri' };
  if (scheduledTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) {
    return { error: 'Navbat vaqti noto\'g\'ri (HH:MM)' };
  }
  if (!Number.isFinite(price) || price < 0 || price > 1e12) return { error: 'Narx noto\'g\'ri' };
  const amount = (value, label) => {
    if (value === '' || value === null || value === undefined) return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) throw crm.badRequest(`${label} noto'g'ri`);
    return n;
  };
  let parts_cost;
  let labor_cost;
  try {
    // A field the body does not mention keeps the value already on the record:
    // an edit that did not touch the parts cost must not zero it out.
    parts_cost = has('parts_cost')
      ? amount(b.parts_cost, 'Ehtiyot qismlar narxi')
      : (existing ? Number(existing.parts_cost) || 0 : 0);
    labor_cost = has('labor_cost')
      ? amount(b.labor_cost, 'Ish haqi narxi')
      : (existing ? Number(existing.labor_cost) || 0 : 0);
  } catch (err) {
    return { error: err.message };
  }
  // The price is the amount charged for the job and is quoted in one currency,
  // chosen with the log. It is a NUMERIC(14,2) label like the warehouse's, so the
  // historical decimal support stays; the currency only decides how it is shown.
  let currency;
  try {
    currency = normalizeCurrency(b.currency);
  } catch (err) {
    return { error: err.message };
  }
  const clean = (v, n) => String(v || '').trim().slice(0, n);
  // A field the body does not mention keeps the value already on the record: an
  // edit that did not touch the customer, the car or the costs of a job must
  // not quietly rewrite them.
  const keep = (key, n) => (has(key) ? clean(b[key], n) : (existing ? clean(existing[key], n) : ''));
  return {
    title,
    customer_name: keep('customer_name', 150),
    customer_phone: keep('customer_phone', 40),
    car_brand: keep('car_brand', 80),
    car_model: keep('car_model', 80),
    car_number: keep('car_number', 30),
    service_type: canonicalType,
    description: clean(b.description, 5000),
    diagnosis: clean(b.diagnosis, 5000),
    start_date: clean(b.start_date, 20),
    end_date: clean(b.end_date, 20),
    scheduled_time: scheduledTime,
    parts_cost,
    labor_cost,
    price,
    price_sent: priceSent,
    currency,
    status,
    notes: clean(b.notes, 2000),
  };
}

function nowSql() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function resolveWorkRelations(b, v, existing) {
  const hadCustomerKey = Object.prototype.hasOwnProperty.call(b, 'customer_id');
  const customerRaw = hadCustomerKey ? b.customer_id : existing && existing.customer_id;
  const customerIdInput = customerRaw === '' || customerRaw === null || customerRaw === undefined
    ? null
    : crm.positiveId(customerRaw);
  if (customerRaw !== '' && customerRaw !== null && customerRaw !== undefined && !customerIdInput) {
    throw crm.badRequest("Mijoz noto'g'ri");
  }
  let customer = customerIdInput ? await crm.findCustomer(db, customerIdInput) : null;
  if (customerIdInput && !customer) throw crm.badRequest('Mijoz topilmadi');

  if (!customer && !hadCustomerKey && existing && existing.customer_id) {
    customer = await crm.findCustomer(db, existing.customer_id);
  }
  if (!customer && (v.customer_name || v.customer_phone)) {
    customer = await crm.findOrCreateCustomer(db, {
      full_name: v.customer_name,
      phone: v.customer_phone,
    });
  }

  const hadVehicleKey = Object.prototype.hasOwnProperty.call(b, 'vehicle_id');
  const vehicleRaw = hadVehicleKey ? b.vehicle_id : existing && existing.vehicle_id;
  const vehicleIdInput = vehicleRaw === '' || vehicleRaw === null || vehicleRaw === undefined
    ? null
    : crm.positiveId(vehicleRaw);
  if (vehicleRaw !== '' && vehicleRaw !== null && vehicleRaw !== undefined && !vehicleIdInput) {
    throw crm.badRequest("Avtomobil noto'g'ri");
  }
  let vehicle = vehicleIdInput ? await crm.findVehicle(db, vehicleIdInput) : null;
  if (vehicleIdInput && !vehicle) throw crm.badRequest('Avtomobil topilmadi');
  if (!vehicle && !hadVehicleKey && existing && existing.vehicle_id) {
    vehicle = await crm.findVehicle(db, existing.vehicle_id);
  }
  if (vehicle && customer && vehicle.customer_id && vehicle.customer_id !== customer.id) {
    throw crm.badRequest("Avtomobil boshqa mijozga tegishli");
  }
  if (!customer && vehicle && vehicle.customer_id) {
    customer = await crm.findCustomer(db, vehicle.customer_id);
  }
  // A vehicle is looked up (or created) only when the body carries car details
  // of its own. A body that merely keeps the car of an existing record must not
  // create a vehicle behind the operator's back.
  const carInBody = b.car_brand || b.car_model || b.car_number;
  if (!vehicle && customer && carInBody) {
    vehicle = await crm.findOrCreateVehicle(db, {
      brand: v.car_brand,
      model: v.car_model,
      plate_number: v.car_number,
    }, customer.id);
  }

  if (customer) {
    if (!v.customer_name) v.customer_name = customer.full_name || '';
    if (!v.customer_phone) v.customer_phone = customer.phone || '';
  }
  if (vehicle) {
    if (!v.car_brand) v.car_brand = vehicle.brand || '';
    if (!v.car_model) v.car_model = vehicle.model || '';
    if (!v.car_number) v.car_number = vehicle.plate_number || '';
  }
  return {
    customer_id: customer ? customer.id : null,
    vehicle_id: vehicle ? vehicle.id : null,
  };
}

/**
 * The money of a work log.
 *
 * The form carries no job price of its own: the amount that was paid IS the
 * price of the job. So the price is derived -- a price that is sent explicitly
 * (an older API client, the conversion of an appointment) still wins, and an
 * edit never lowers a price that is already on the record, so an old total is
 * not silently rewritten by a payment that is smaller than it.
 *
 * A master may not move the money -- only a super admin does -- so for a
 * master the amount is the one already on the record.
 */
function resolveMoney(v, b, existing, privileged) {
  let paid = existing ? Number(existing.paid_amount) || 0 : 0;
  if (privileged && b.paid_amount !== undefined) {
    paid = b.paid_amount === '' || b.paid_amount === null ? 0 : Number(b.paid_amount);
  }
  if (!Number.isFinite(paid) || paid < 0 || paid > 1e12) throw crm.badRequest("To'langan summa noto'g'ri");
  const storedPrice = existing ? Number(existing.price) || 0 : 0;
  const price = v.price_sent ? v.price : Math.max(storedPrice, paid);
  return { paid, price };
}

function validatePayment(b, existing, price, privileged, paid) {
  if (!privileged) {
    return existing
      ? {
          payment_status: existing.payment_status || 'unpaid',
          paid_amount: Number(existing.paid_amount) || 0,
          payment_method: existing.payment_method || '',
        }
      : { payment_status: 'unpaid', paid_amount: 0, payment_method: '' };
  }
  let status = b.payment_status === undefined
    ? (existing ? existing.payment_status : 'unpaid')
    : String(b.payment_status || '').trim();
  if (!PAYMENT_STATUSES.includes(status)) throw crm.badRequest("To'lov holati noto'g'ri");
  if (!Number.isFinite(paid) || paid < 0 || paid > 1e12) throw crm.badRequest("To'langan summa noto'g'ri");
  if (paid > price) throw crm.badRequest("To'langan summa ish narxidan katta bo'lishi mumkin emas");
  // The status follows the money: the form does not carry a status of its own,
  // so a payment that was entered decides whether the job is unpaid, partly
  // paid or paid. A client that sends a status of its own still decides it.
  if (b.payment_status === undefined && b.paid_amount !== undefined) {
    status = paid <= 0 ? 'unpaid' : paid >= price ? 'paid' : 'partially_paid';
  }
  if (status === 'unpaid') paid = 0;
  if (status === 'paid') paid = price;
  if (status === 'partially_paid' && !(paid > 0 && paid < price)) {
    throw crm.badRequest("Qismiy to'lov summasi 0 dan katta va ish narxidan kichik bo'lishi kerak");
  }
  return {
    payment_status: status,
    paid_amount: paid,
    payment_method: b.payment_method === undefined && existing
      ? (existing.payment_method || '')
      : crm.text(b.payment_method, "To'lov turi", { max: 40 }),
  };
}

async function recordStatus(runner, workId, fromStatus, toStatus, req, note = '') {
  await runner
    .prepare(
      `INSERT INTO work_log_status_history (work_log_id, from_status, to_status, admin_id, admin_name, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(workId, fromStatus || '', toStatus, req.user.id, req.user.full_name || '', note);
}

async function syncAppointmentStatus(appointmentId, workStatus) {
  if (!appointmentId) return;
  const next = workStatus === 'Kutilayotgan'
    ? 'Tasdiqlangan'
    : workStatus === 'Jarayonda'
      ? 'Jarayonda'
      : workStatus === 'Tugallangan'
        ? 'Tugallangan'
        : 'Bekor qilingan';
  await db
    .prepare('UPDATE appointments SET status = ?, updated_at = app_now() WHERE id = ?')
    .run(next, appointmentId);
}

router.get('/', async (req, res) => {
  const conds = [];
  const params = [];
  if (!isSA(req.user)) {
    conds.push('w.master_id = ?');
    params.push(req.user.id);
  } else if (String(req.query.master_id || '').trim()) {
    conds.push('w.master_id = ?');
    params.push(Number(req.query.master_id));
  }
  if (String(req.query.service_type || '').trim()) {
    conds.push('w.service_type = ?');
    params.push(String(req.query.service_type));
  }
  if (String(req.query.status || '').trim()) {
    conds.push('w.status = ?');
    params.push(String(req.query.status));
  }
  if (String(req.query.payment_status || '').trim()) {
    conds.push('w.payment_status = ?');
    params.push(String(req.query.payment_status));
  }
  if (String(req.query.customer_id || '').trim()) {
    const customerId = crm.positiveId(req.query.customer_id);
    if (customerId) {
      conds.push('w.customer_id = ?');
      params.push(customerId);
    }
  }
  if (String(req.query.vehicle_id || '').trim()) {
    const vehicleId = crm.positiveId(req.query.vehicle_id);
    if (vehicleId) {
      conds.push('w.vehicle_id = ?');
      params.push(vehicleId);
    }
  }
  if (String(req.query.date_from || '').trim()) {
    conds.push('(w.created_at)::date >= (? )::date');
    params.push(String(req.query.date_from));
  }
  if (String(req.query.date_to || '').trim()) {
    conds.push('(w.created_at)::date <= (? )::date');
    params.push(String(req.query.date_to));
  }
  if (String(req.query.q || '').trim()) {
    const like = '%' + String(req.query.q).trim() + '%';
    conds.push(`(w.title ILIKE ? OR w.customer_name ILIKE ? OR w.customer_phone ILIKE ?
      OR w.car_brand ILIKE ? OR w.car_model ILIKE ? OR w.car_number ILIKE ?
      OR CAST(w.id AS TEXT) ILIKE ?)`);
    params.push(like, like, like, like, like, like, like);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const wantsPage = String(req.query.page || '').trim() !== '' || String(req.query.per_page || '').trim() !== '';
  const baseSql = `SELECT ${WORK_LIST_FIELDS} FROM work_logs w LEFT JOIN users u ON u.id = w.master_id ${where} ORDER BY w.created_at DESC, w.id DESC`;
  let rows;
  let pagination = null;
  if (wantsPage) {
    const totalRow = await db.prepare(`SELECT COUNT(*)::int total FROM work_logs w ${where}`).get(params);
    const total = Number(totalRow.total) || 0;
    const perPageRaw = Number.parseInt(req.query.per_page, 10);
    const perPage = Math.min(100, Math.max(1, Number.isInteger(perPageRaw) ? perPageRaw : 8));
    const pages = Math.max(1, Math.ceil(total / perPage));
    const pageRaw = Number.parseInt(req.query.page, 10);
    const page = Math.min(pages, Math.max(1, Number.isInteger(pageRaw) ? pageRaw : 1));
    rows = await db
      .prepare(`${baseSql} LIMIT ? OFFSET ?`)
      .all([...params, perPage, (page - 1) * perPage]);
    pagination = { page, per_page: perPage, total, pages };
  } else {
    rows = await db.prepare(baseSql).all(params);
  }
  // One batched query for the whole page, so the list does not pay a per-row
  // round trip just to show which oil went into which job.
  const mats = await materialsFor(rows.map((r) => r.id));
  const out = [];
  for (const row of rows) {
    const w = await decorate(row);
    w.materials = mats.get(row.id) || [];
    out.push(w);
  }
  res.json(pagination ? { worklogs: out, pagination } : { worklogs: out });
});

router.get('/stats', async (req, res) => {
  const conds = [];
  const params = [];
  if (!isSA(req.user)) {
    conds.push('master_id = ?');
    params.push(req.user.id);
  } else if (String(req.query.master_id || '').trim()) {
    conds.push('master_id = ?');
    params.push(Number(req.query.master_id));
  }
  if (String(req.query.service_type || '').trim()) {
    conds.push('service_type = ?');
    params.push(String(req.query.service_type));
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const row = await db
    .prepare(`SELECT COUNT(*)::int total,
      COALESCE(SUM(CASE WHEN status = 'Kutilayotgan' THEN 1 ELSE 0 END), 0)::int waiting,
      COALESCE(SUM(CASE WHEN status = 'Jarayonda' THEN 1 ELSE 0 END), 0)::int in_progress,
      COALESCE(SUM(CASE WHEN status = 'Tugallangan' THEN 1 ELSE 0 END), 0)::int completed,
      COALESCE(SUM(CASE WHEN status = 'Bekor qilingan' THEN 1 ELSE 0 END), 0)::int cancelled,
      COALESCE(SUM(CASE WHEN status = 'Tugallangan' AND currency = 'UZS' THEN price ELSE 0 END), 0) earnings
      FROM work_logs ${where}`)
    .get(params);
  res.json({
    stats: {
      total: row.total,
      waiting: row.waiting,
      inProgress: row.in_progress,
      completed: row.completed,
      cancelled: row.cancelled,
      earnings: Number(row.earnings) || 0,
    },
  });
});

router.post('/', async (req, res) => {
  let masterId;
  if (isSA(req.user)) {
    masterId = Number(req.body && req.body.master_id);
    // A missing or non-numeric master_id must be rejected here: passing it on
    // would reach PostgreSQL as NaN and abort the request with a 500.
    if (!Number.isInteger(masterId) || masterId <= 0) {
      return res.status(400).json({ error: 'Ish bajaruvchi ustani tanlang' });
    }
    const m = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'master'").get(masterId);
    if (!m) return res.status(400).json({ error: 'Ish bajaruvchi ustani tanlang' });
  } else {
    masterId = req.user.id;
  }
  const body = req.body || {};
  const v = validateWorkBody(body, undefined, await serviceTypeCatalog());
  if (v.error) return res.status(400).json({ error: v.error });
  const rel = await resolveWorkRelations(body, v, null);
  let payment;
  let money;
  try {
    money = resolveMoney(v, body, null, isSA(req.user));
    payment = validatePayment(body, null, money.price, isSA(req.user), money.paid);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  // Shape-only validation. Sufficiency is checked under the row lock below, in
  // the same transaction as the insert.
  const materials = validateMaterials(body.materials);
  // Stock is an admin asset: a master may file a work log but must not move it.
  if (materials.length && !isSA(req.user)) {
    return res.status(403).json({ error: 'Ombordan mahsulot sarflash faqat admin uchun' });
  }
  const isPublic = isSA(req.user) ? (body.is_public ? 1 : 0) : 0;
  const completedAt = v.status === 'Tugallangan' ? nowSql() : null;

  // The work log and its stock movements share one transaction. Without it, a
  // short second material would leave a work log recorded with no oil taken, or
  // -- worse -- oil taken for a work log that never got written.
  const inserted = await db.transaction(async (t) => {
    // RETURNING id replaces SQLite's last_insert_rowid().
    const work = await t
      .prepare(`INSERT INTO work_logs
        (master_id, customer_id, vehicle_id, title, customer_name, customer_phone, car_brand,
         car_model, car_number, service_type, description, diagnosis, start_date, end_date,
         scheduled_time, parts_cost, labor_cost, price, currency, status, payment_status,
         paid_amount, payment_method, completed_at, notes, is_public, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id`)
      .one(
        masterId, rel.customer_id, rel.vehicle_id, v.title, v.customer_name, v.customer_phone,
        v.car_brand, v.car_model, v.car_number, v.service_type, v.description, v.diagnosis,
        v.start_date, v.end_date, v.scheduled_time, v.parts_cost, v.labor_cost, money.price,
        v.currency, v.status, payment.payment_status, payment.paid_amount, payment.payment_method,
        completedAt, v.notes, isPublic, req.user.id
      );
    await recordStatus(t, work.id, '', v.status, req, 'Ish yaratildi');
    await consumeMaterials(t, req, work.id, materials);
    return work;
  });

  const created = await loadWork(inserted.id);
  const decorated = await decorate(created);
  // Same shape as GET /:id, so a client that submits materials does not have to
  // issue a second request to learn what was actually taken.
  decorated.materials = (await materialsFor([created.id])).get(created.id) || [];
  res.status(201).json({ work: decorated });
});

/**
 * The catalogue behind every "Xizmat turi" select.
 *
 * Active rows only, in catalogue order, so what the operator picks is what the
 * shop offers today and in the arrangement made on /admin/services. Declared
 * before `GET /:id` on purpose: a router matches in order, and `/services` would
 * otherwise be read as a work-log id and answer 404.
 */
router.get('/services', async (req, res) => {
  const services = await db
    .prepare('SELECT id, name, icon, sort_order FROM services WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
    .all();
  res.json({ services });
});

router.get('/:id', async (req, res) => {
  const work = await loadWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Ish topilmadi' });
  if (!canAccess(req, work)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  const decorated = await decorate(work);
  decorated.materials = (await materialsFor([work.id])).get(work.id) || [];
  decorated.status_history = await statusHistoryFor(work.id);
  res.json({ work: decorated });
});

router.patch('/:id/status', async (req, res) => {
  const work = await loadWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Ish topilmadi' });
  if (!canAccess(req, work)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  const next = String((req.body && req.body.status) || '').trim();
  if (!STATUSES.includes(next)) return res.status(400).json({ error: 'Ish holati noto\'g\'ri' });
  if (next === work.status) {
    return res.status(409).json({ error: `Ish allaqachon "${work.status}" holatida` });
  }
  const allowed = STATUS_TRANSITIONS[work.status] || [];
  if (!allowed.includes(next)) {
    return res.status(409).json({
      error: `"${work.status}" holatidan "${next}" holatiga o'tib bo'lmaydi`,
    });
  }
  await db.transaction(async (t) => {
    await t
      .prepare(`UPDATE work_logs SET status = ?,
        completed_at = CASE WHEN ? = 'Tugallangan' THEN COALESCE(completed_at, app_now()) ELSE completed_at END,
        updated_at = app_now() WHERE id = ?`)
      .run(next, next, work.id);
    await recordStatus(t, work.id, work.status, next, req);
  });
  await syncAppointmentStatus(work.appointment_id, next);
  res.json({ work: await decorate(await loadWork(work.id)) });
});

router.put('/:id', async (req, res) => {
  const work = await loadWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Ish topilmadi' });
  if (!canAccess(req, work)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  const b = req.body || {};
  const currentPublic = work.is_public ? 1 : 0;
  if ('is_public' in b && !isSA(req.user) && toFlag(b.is_public) !== currentPublic) {
    return res.status(403).json({ error: 'Faqat super admin saytda ko\'rsatishni sozlashi mumkin' });
  }
  const v = validateWorkBody(b, work.service_type, await serviceTypeCatalog(), work);
  if (v.error) return res.status(400).json({ error: v.error });
  const rel = await resolveWorkRelations(b, v, work);
  let payment;
  let money;
  try {
    money = resolveMoney(v, b, work, isSA(req.user));
    payment = validatePayment(b, work, money.price, isSA(req.user), money.paid);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const isPublic = 'is_public' in b ? toFlag(b.is_public) : currentPublic;
  const completedAt = v.status === 'Tugallangan' ? (work.completed_at || nowSql()) : work.completed_at;
  // Must be awaited: the response body is re-read from the database right after,
  // so an unawaited write would return the previous values.
  await db.transaction(async (t) => {
    await t.prepare(`UPDATE work_logs SET
        title = ?, customer_id = ?, vehicle_id = ?, customer_name = ?, customer_phone = ?,
        car_brand = ?, car_model = ?, car_number = ?, service_type = ?, description = ?,
        diagnosis = ?, start_date = ?, end_date = ?, scheduled_time = ?, parts_cost = ?,
        labor_cost = ?, price = ?, currency = ?, status = ?, payment_status = ?, paid_amount = ?,
        payment_method = ?, completed_at = ?, notes = ?, is_public = ?, updated_at = app_now()
      WHERE id = ?`)
      .run(
        v.title, rel.customer_id, rel.vehicle_id, v.customer_name, v.customer_phone,
        v.car_brand, v.car_model, v.car_number, v.service_type, v.description, v.diagnosis,
        v.start_date, v.end_date, v.scheduled_time, v.parts_cost, v.labor_cost, money.price,
        v.currency, v.status, payment.payment_status, payment.paid_amount, payment.payment_method,
        completedAt, v.notes, isPublic, work.id
      );
    if (v.status !== work.status) {
      await recordStatus(t, work.id, work.status, v.status, req);
    }
  });
  if (v.status !== work.status) await syncAppointmentStatus(work.appointment_id, v.status);
  res.json({ work: await decorate(await loadWork(work.id)) });
});

router.delete('/:id', async (req, res, next) => {
  const work = await loadWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Ish topilmadi' });
  if (!canAccess(req, work)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  // Read the object keys before the delete: the rows are removed by ON DELETE CASCADE.
  const images = await db.prepare('SELECT image_path, object_key FROM work_log_images WHERE work_log_id = ?').all(work.id);
  await db.prepare('DELETE FROM work_logs WHERE id = ?').run(work.id);
  try {
    for (const img of images) {
      if (img.object_key) {
        await storage.remove(img.object_key);
      } else {
        await fs.promises.unlink(path.join(WORK_DIR, img.image_path)).catch(() => {});
      }
    }
  } catch (err) {
    next(err);
    return;
  }
  res.json({ ok: true });
});

async function ownedWork(req, res, next) {
  try {
    const work = await loadWork(req.params.id);
    if (!work) return res.status(404).json({ error: 'Ish topilmadi' });
    if (!canAccess(req, work)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    req.work = work;
    next();
  } catch (err) {
    next(err);
  }
}

router.post('/:id/images', ownedWork, (req, res) => {
  workUpload.array('files', 10)(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Rasm juda katta (maks 5MB)' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Bitta so\'rovda ko\'pi bilan 10 ta rasm yuboriladi' });
      if (err.status === 400 && err.message) return res.status(400).json({ error: err.message });
      if (err.message && err.message.startsWith('Faqat')) return res.status(400).json({ error: err.message });
      return res.status(400).json({ error: 'Rasm yuklashda xatolik' });
    }
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'Rasm yuklanmadi' });

    const removeLocal = () => {
      for (const f of files) {
        if (f.path) fs.promises.unlink(f.path).catch(() => {});
      }
    };

    const count = await db.prepare('SELECT COUNT(*) c FROM work_log_images WHERE work_log_id = ?').get(req.work.id);
    if (Number(count.c) + files.length > MAX_WORK_IMAGES) {
      removeLocal();
      return res.status(400).json({ error: `Bitta ishga ko'pi bilan ${MAX_WORK_IMAGES} ta rasm qo'shish mumkin` });
    }

    // Keys created during this request, so a half-finished batch can be undone.
    const uploadedKeys = [];
    const insertedIds = [];
    try {
      for (const f of files) {
        const imagePath = f.filename || uniqueWorkFilename(f.originalname);
        let objectKey = '';
        if (storage.enabled) {
          // Work-log images are not public content: they use the private key
          // prefix (and the private bucket when one is configured), so they can
          // only be read through /api/workimages/:filename.
          objectKey = storage.makePrivateKey(f.mimetype);
          await storage.upload({ key: objectKey, mime: f.mimetype, body: f.buffer });
          uploadedKeys.push(objectKey);
        }
        const row = await db
          .prepare('INSERT INTO work_log_images (work_log_id, image_path, original_filename, object_key) VALUES (?, ?, ?, ?) RETURNING id')
          .one(req.work.id, imagePath, f.originalname, objectKey);
        insertedIds.push(row.id);
      }
      res.status(201).json({ images: await imagesFor(req.work.id) });
    } catch (e) {
      // Nothing may be left half-attached: drop the R2 objects and the metadata
      // rows created by this request, then remove any local temp files.
      for (const id of insertedIds) {
        await db.prepare('DELETE FROM work_log_images WHERE id = ?').run(id).catch(() => {});
      }
      for (const key of uploadedKeys) {
        await storage.remove(key).catch(() => {});
      }
      removeLocal();
      next(e);
    }
  });
});

router.delete('/images/:imageId', async (req, res, next) => {
  const imageId = Number(req.params.imageId);
  if (!Number.isInteger(imageId)) return res.status(400).json({ error: 'Noto\'g\'ri rasm ID' });
  const img = await db.prepare('SELECT * FROM work_log_images WHERE id = ?').get(imageId);
  if (!img) return res.status(404).json({ error: 'Rasm topilmadi' });
  const work = await db.prepare('SELECT id, master_id FROM work_logs WHERE id = ?').get(img.work_log_id);
  if (!work) return res.status(404).json({ error: 'Ish topilmadi' });
  if (!canAccess(req, work)) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  await db.prepare('DELETE FROM work_log_images WHERE id = ?').run(img.id);
  try {
    if (img.object_key) {
      await storage.remove(img.object_key);
    } else {
      await fs.promises.unlink(path.join(WORK_DIR, img.image_path)).catch(() => {});
    }
  } catch (err) {
    next(err);
    return;
  }
  res.json({ ok: true, images: await imagesFor(work.id) });
});

module.exports = router;