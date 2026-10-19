const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const auth = require('../auth');
const rateLimit = require('../rateLimit');
const {
  CURRENCIES,
  normalizeCurrency,
  isCurrency,
  moneySymbol,
  parseMoney,
  parseMoneyOrZero,
  MAX_AMOUNT,
} = require('../currency');

const router = require('../asyncRoute').wrapRouter(express.Router());

// Every expense endpoint is super_admin-only. The ledger records what the
// workshop owes its suppliers, so it is gated exactly like the warehouse: a
// master never sees it, and there is no public branch anywhere in this file.
router.use(auth.authenticate);
router.use(auth.authorize('super_admin'));

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** Text field: trimmed, length-capped so one row cannot hold a novel. */
function text(value, field, { required = false, max = 2000 } = {}) {
  const v = String(value == null ? '' : value).trim();
  if (required && !v) throw badRequest(`${field} to'ldirilishi shart`);
  if (v.length > max) throw badRequest(`${field} juda uzun`);
  return v;
}

const CATEGORIES = ['oil', 'filter', 'service', 'other'];
const CATEGORY_UZ = { oil: 'Moy', filter: 'Filtr', service: 'Xizmat', other: 'Boshqa' };
const STATUS_UZ = { unpaid: "To'lanmagan", partially_paid: "Qisman to'langan", paid: "To'langan" };

function parseCategory(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return 'other';
  if (!CATEGORIES.includes(v)) throw badRequest("Bo'lim noto'g'ri (moy, filtr, xizmat yoki boshqa)");
  return v;
}

/** Quantity is NUMERIC(12,3): up to three decimals, strictly positive. */
function parseQuantity(value, field) {
  if (value === undefined || value === null || value === '') return 1;
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) {
    throw badRequest(`${field} noto'g'ri (musbat son, maksimum 3 xona kasr)`);
  }
  const n = Number(raw);
  if (!(n > 0)) throw badRequest(`${field} 0 dan katta bo'lishi kerak`);
  return n;
}

/** Rounds qty x price to the currency's precision, for the computed-total path. */
function roundMoney(value, currency) {
  return currency === 'UZS' ? Math.round(value) : Math.round(value * 100) / 100;
}

function parseDueDate(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest("Muddat YYYY-MM-DD ko'rinishida bo'lishi kerak");
  return v;
}

/** Status is derived from the amounts, never taken from the request body. */
function statusFor(totalAmount, paidAmount) {
  if (paidAmount <= 0) return 'unpaid';
  if (paidAmount >= totalAmount) return 'paid';
  return 'partially_paid';
}

/** Resolves the optional master link to a real user id, or null. */
async function resolveMasterId(executor, value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Usta noto'g'ri tanlangan");
  const row = await executor.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!row) throw badRequest('Usta topilmadi');
  return id;
}

// ---------------------------------------------------------------------------
// Search / filter / sort / pagination
// ---------------------------------------------------------------------------

function likeTerm(value) {
  return `%${String(value).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

const SORTS = {
  newest: 'e.created_at DESC, e.id DESC',
  oldest: 'e.created_at ASC, e.id ASC',
  largest: 'e.total_amount DESC, e.id DESC',
  remaining: 'e.remaining_amount DESC, e.id DESC',
};

const FILTERS = {
  all: null,
  unpaid: "e.status = 'unpaid' AND e.remaining_amount > 0",
  partially_paid: "e.status = 'partially_paid' AND e.remaining_amount > 0",
  paid: "e.status = 'paid'",
  archive: null,
};

/** Inclusive-exclusive next-day bound so `created_at TEXT` compares cleanly. */
function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function listQuery(req) {
  const q = text(req.query.q ?? req.query.search, 'q', { max: 120 });
  const filterKeyRaw = req.query.filter ?? req.query.status;
  const filterKey = FILTERS[filterKeyRaw] !== undefined ? filterKeyRaw : 'all';
  const filter = FILTERS[filterKey];
  const archived = filterKey === 'archive';

  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(5, Number.parseInt(req.query.per_page) || 20));
  const orderBy = SORTS[req.query.sort] || SORTS.newest;

  const where = [archived ? 'e.deleted_at IS NOT NULL' : 'e.deleted_at IS NULL'];
  const params = [];

  if (q) {
    const term = likeTerm(q);
    where.push("(e.item_name ILIKE ? ESCAPE '\\' OR e.supplier ILIKE ? ESCAPE '\\' OR e.phone ILIKE ? ESCAPE '\\')");
    params.push(term, term, term);
  }
  if (filter) where.push(filter);

  if (req.query.currency !== undefined && req.query.currency !== '') {
    if (!isCurrency(req.query.currency)) throw badRequest("Valyuta noto'g'ri: faqat UZS yoki USD");
    where.push('e.currency = ?');
    params.push(normalizeCurrency(req.query.currency));
  }
  if (req.query.category !== undefined && req.query.category !== '') {
    where.push('e.category = ?');
    params.push(parseCategory(req.query.category));
  }
  if (req.query.master_id !== undefined && req.query.master_id !== '') {
    const mid = Number(req.query.master_id);
    if (!Number.isInteger(mid) || mid <= 0) throw badRequest("Usta filtri noto'g'ri");
    where.push('e.master_id = ?');
    params.push(mid);
  }
  if (req.query.supplier !== undefined && req.query.supplier !== '') {
    where.push("e.supplier ILIKE ? ESCAPE '\\'");
    params.push(likeTerm(text(req.query.supplier, 'supplier', { max: 200 })));
  }
  if (req.query.date_from !== undefined && req.query.date_from !== '') {
    const from = parseDueDate(req.query.date_from) || text(req.query.date_from, 'date_from', { max: 30 });
    where.push('e.created_at >= ?');
    params.push(from);
  }
  if (req.query.date_to !== undefined && req.query.date_to !== '') {
    const to = parseDueDate(req.query.date_to);
    if (!to) throw badRequest("date_to YYYY-MM-DD ko'rinishida bo'lishi kerak");
    where.push('e.created_at < ?');
    params.push(nextDay(to));
  }

  return { where: where.join(' AND '), params, page, perPage, orderBy, archived, filterKey };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

async function audit(t, req, expenseId, action, metadata) {
  await t
    .prepare(
      'INSERT INTO expense_audit_logs (expense_id, action, admin_id, admin_name, metadata) VALUES (?, ?, ?, ?, ?)'
    )
    .run(expenseId == null ? null : Number(expenseId), action, req.user.id, req.user.full_name || '', JSON.stringify(metadata || {}));
}

/**
 * Commits an audit row outside of any delete transaction, so a refused delete
 * leaves a durable record even though the request throws and rolls back.
 */
async function auditStandalone(req, expenseId, action, metadata) {
  try {
    await audit(db, req, expenseId, action, metadata);
  } catch {
    // Never let audit bookkeeping mask the real reason the delete failed.
  }
}

function snapshot(e) {
  return {
    item_name: e.item_name,
    supplier: e.supplier,
    total_amount: Number(e.total_amount),
    paid_amount: Number(e.paid_amount),
    remaining_amount: Number(e.remaining_amount),
    currency: e.currency,
    status: e.status,
  };
}

const EXPENSE_FIELDS =
  'id, item_name, description, supplier, phone, category, quantity, unit, unit_price, total_amount, paid_amount, remaining_amount, currency, status, due_date, master_id, created_at, updated_at, created_by, deleted_at';

function present(e) {
  return {
    ...e,
    status_label: STATUS_UZ[e.status] || e.status,
    category_label: CATEGORY_UZ[e.category] || e.category,
    money_symbol: moneySymbol(e.currency),
  };
}

// ---------------------------------------------------------------------------
// DELETE pass key (shared secret with the debt ledger)
// ---------------------------------------------------------------------------

/**
 * Checks the archive pass key against DEBT_DELETE_PASS_KEY, timing-safely.
 *
 * The same secret guards the money ledgers, so it is deliberately shared rather
 * than duplicated: one env var protects both archives. It fails closed when the
 * key is unset, and the supplied value is never logged or stored.
 */
function deletePassKeyOk(req) {
  const configured = String(process.env.DEBT_DELETE_PASS_KEY || '');
  if (!configured) {
    const err = new Error(
      "O'chirish vaqtincha faol emas. Server sozlamalarida DEBT_DELETE_PASS_KEY belgilanmagan."
    );
    err.status = 503;
    err.expose = true;
    throw err;
  }

  const header = req.headers['x-debt-pass-key'];
  const bearer = String(req.headers.authorization || '');
  const bearerValue = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
  const provided = String(header || req.body?.pass_key || bearerValue || '').trim();
  if (!provided) {
    rateLimit.recordDebtDeleteFailure(req);
    throw forbidden();
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    rateLimit.recordDebtDeleteFailure(req);
    throw forbidden();
  }
  return true;
}

function forbidden() {
  const err = new Error("Pass key noto'g'ri");
  err.status = 403;
  return err;
}

function paidOnly() {
  const err = new Error("Bu hisob hali to'liq to'lanmagan.");
  err.status = 409;
  return err;
}

function archivedOnly() {
  const err = new Error('Bu hisob arxivlangan.');
  err.status = 409;
  return err;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function csvCell(value) {
  let v = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV export of the rows currently in view.
 *
 * Every row carries its own currency and the file never adds USD to UZS; a
 * reader filters the `Valyuta` column. Pagination is ignored on purpose -- an
 * export that stops at 20 rows is worse than useless on a ledger.
 */
router.get('/export.csv', async (req, res) => {
  const { where, params } = listQuery(req);
  const rows = await db
    .prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses e WHERE ${where} ORDER BY e.created_at DESC, e.id DESC`)
    .all(...params);

  const header = ['Nomi', "Bo'lim", 'Yetkazib beruvchi', 'Telefon', 'Miqdor', 'Birlik', 'Birlik narxi', 'Umumiy summa', "To'langan", 'Qolgan', 'Valyuta', 'Holat', 'Muddat', 'Sana'];
  const body = rows.map((e) => [
    e.item_name,
    CATEGORY_UZ[e.category] || e.category,
    e.supplier,
    e.phone,
    e.quantity,
    e.unit,
    e.unit_price,
    e.total_amount,
    e.paid_amount,
    e.remaining_amount,
    e.currency,
    STATUS_UZ[e.status] || e.status,
    e.due_date,
    e.created_at,
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="moy-hisob-kitob-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send([header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n'));
});

/**
 * Ledger-wide statistics, split per currency.
 *
 * Counts are currency-agnostic; money totals are grouped by currency so a UZS
 * figure is never summed with a USD one. Both supported currencies are always
 * present (zero-filled) so the UI can render a stable pair of cards.
 */
router.get('/stats', async (req, res) => {
  const counts = await db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE deleted_at IS NULL)                              AS total,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'unpaid')        AS unpaid,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'partially_paid') AS partially_paid,
         COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'paid')          AS paid,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)                          AS archived
       FROM expenses`
    )
    .get();

  const money = await db
    .prepare(
      `SELECT currency,
              COUNT(*)::int                                              AS count,
              COUNT(*) FILTER (WHERE remaining_amount > 0)::int          AS open_count,
              COALESCE(SUM(total_amount), 0)                             AS total_amount,
              COALESCE(SUM(paid_amount), 0)                              AS total_paid,
              COALESCE(SUM(GREATEST(remaining_amount, 0)), 0)            AS total_remaining
         FROM expenses WHERE deleted_at IS NULL GROUP BY currency`
    )
    .all();

  const byCurrencyMap = new Map(money.map((m) => [m.currency, m]));
  const currencies = CURRENCIES.map((currency) => {
    const m = byCurrencyMap.get(currency) || {};
    return {
      currency,
      count: Number(m.count || 0),
      openCount: Number(m.open_count || 0),
      totalAmount: Number(m.total_amount || 0),
      totalPaid: Number(m.total_paid || 0),
      totalRemaining: Number(m.total_remaining || 0),
    };
  });

  res.json({
    stats: {
      total: Number(counts.total),
      unpaid: Number(counts.unpaid),
      partiallyPaid: Number(counts.partially_paid),
      paid: Number(counts.paid),
      archived: Number(counts.archived),
      currencies,
    },
  });
});

router.get('/', async (req, res) => {
  const { where, params, page, perPage, orderBy, archived } = listQuery(req);

  const rows = await db
    .prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses e WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all([...params, perPage, (page - 1) * perPage]);
  const total = Number(
    (await db.prepare(`SELECT COUNT(*) c FROM expenses e WHERE ${where}`).get(...params)).c
  );

  res.json({
    expenses: rows.map(present),
    pagination: { page, per_page: perPage, total, pages: Math.max(1, Math.ceil(total / perPage)) },
    archived,
  });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const currency = normalizeCurrency(body.currency);

  const item_name = text(body.item_name ?? body.name, 'Nomi', { required: true, max: 200 });
  const description = text(body.description, 'Izoh', { max: 4000 });
  const supplier = text(body.supplier, 'Yetkazib beruvchi', { max: 200 });
  const phone = text(body.phone, 'Telefon', { max: 60 });
  const category = parseCategory(body.category);
  const quantity = parseQuantity(body.quantity, 'Miqdor');
  const unit = text(body.unit, "O'lchov birligi", { max: 30 }) || 'dona';
  const unit_price = parseMoneyOrZero(body.unit_price, 'Birlik narxi', currency);

  // The total may be entered directly (a negotiated figure, which need not equal
  // quantity x price). If it is omitted it is derived from the two factors.
  const totalRaw = body.total_amount ?? body.amount;
  let total_amount;
  if (totalRaw === undefined || totalRaw === null || totalRaw === '') {
    if (unit_price > 0) total_amount = roundMoney(quantity * unit_price, currency);
    else throw badRequest("Umumiy summa to'ldirilishi shart");
    if (!(total_amount > 0) || total_amount > MAX_AMOUNT) throw badRequest("Umumiy summa noto'g'ri");
  } else {
    total_amount = parseMoney(totalRaw, 'Umumiy summa', currency);
  }
  if (total_amount <= 0) throw badRequest("Umumiy summa 0 dan katta bo'lishi kerak");

  const paid_amount = parseMoneyOrZero(body.paid_amount, "To'langan summa", currency);
  if (paid_amount > total_amount) throw badRequest("To'langan summa umumiy summadan katta bo'lishi mumkin emas");

  const due_date = parseDueDate(body.due_date);
  const status = statusFor(total_amount, paid_amount);

  const expense = await db.transaction(async (t) => {
    const master_id = await resolveMasterId(t, body.master_id);

    const created = await t
      .prepare(
        `INSERT INTO expenses
           (item_name, description, supplier, phone, category, quantity, unit, unit_price,
            total_amount, paid_amount, currency, status, due_date, master_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${EXPENSE_FIELDS}`
      )
      .one(
        item_name, description, supplier, phone, category, quantity, unit, unit_price,
        total_amount, paid_amount, currency, status, due_date, master_id, req.user.id
      );

    // An opening payment is mirrored into the ledger so SUM(live payments)
    // always reconciles with paid_amount.
    if (paid_amount > 0) {
      await t
        .prepare('INSERT INTO expense_payments (expense_id, amount, currency, note, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(created.id, paid_amount, currency, "Boshlang'ich to'lov", req.user.id);
    }
    await audit(t, req, created.id, 'created', snapshot(created));
    return created;
  });

  res.status(201).json({ expense: present(expense) });
});

router.get('/:id', async (req, res) => {
  const expense = await db
    .prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses WHERE id = ?`)
    .get(Number(req.params.id));
  if (!expense) return res.status(404).json({ error: 'Hisob topilmadi' });

  const payments = await db
    .prepare(
      `SELECT p.id, p.amount, p.currency, p.note, p.created_at, p.created_by,
              u.full_name AS created_by_name, p.voided_at, p.voided_by, p.void_reason,
              v.full_name AS voided_by_name
         FROM expense_payments p
         LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN users v ON v.id = p.voided_by
        WHERE p.expense_id = ?
        ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(expense.id);
  const auditLogs = await db
    .prepare(
      'SELECT id, action, admin_id, admin_name, metadata, created_at FROM expense_audit_logs WHERE expense_id = ? ORDER BY created_at DESC, id DESC'
    )
    .all(expense.id);

  res.json({ expense: present(expense), payments, audit_logs: auditLogs });
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const seen = await db.prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses WHERE id = ?`).get(id);
  if (!seen) return res.status(404).json({ error: 'Hisob topilmadi' });
  if (seen.deleted_at) return res.status(409).json({ error: 'Arxivdagi hisobni tahrirlash mumkin emas' });

  const body = req.body || {};

  const expense = await db.transaction(async (t) => {
    const current = await t.prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses WHERE id = ? FOR UPDATE`).one(id);
    if (!current) return null;
    if (current.deleted_at) throw archivedOnly();

    const item_name = 'item_name' in body || 'name' in body
      ? text(body.item_name ?? body.name, 'Nomi', { required: true, max: 200 })
      : current.item_name;
    const description = 'description' in body ? text(body.description, 'Izoh', { max: 4000 }) : current.description;
    const supplier = 'supplier' in body ? text(body.supplier, 'Yetkazib beruvchi', { max: 200 }) : current.supplier;
    const phone = 'phone' in body ? text(body.phone, 'Telefon', { max: 60 }) : current.phone;
    const category = 'category' in body ? parseCategory(body.category) : current.category;
    const quantity = 'quantity' in body ? parseQuantity(body.quantity, 'Miqdor') : Number(current.quantity);
    const unit = 'unit' in body ? (text(body.unit, "O'lchov birligi", { max: 30 }) || 'dona') : current.unit;

    // The currency is fixed once money has moved: changing it would silently
    // relabel a USD payment as so'm. Before the first payment it may be corrected.
    const currency = 'currency' in body ? normalizeCurrency(body.currency, { required: true }) : current.currency;
    if (currency !== current.currency && Number(current.paid_amount) > 0) {
      const err = new Error("To'lov qilingan hisobning valyutasini o'zgartirish mumkin emas");
      err.status = 409;
      throw err;
    }

    const unit_price = 'unit_price' in body ? parseMoneyOrZero(body.unit_price, 'Birlik narxi', currency) : Number(current.unit_price);
    const total_amount = 'total_amount' in body || 'amount' in body
      ? parseMoney(body.total_amount ?? body.amount, 'Umumiy summa', currency)
      : Number(current.total_amount);
    if (total_amount <= 0) throw badRequest("Umumiy summa 0 dan katta bo'lishi kerak");

    const paid_amount = Number(current.paid_amount);
    if (paid_amount > total_amount) {
      throw badRequest("Umumiy summani kamaytirish mumkin emas: to'langan summa yangi summadan katta bo'lib ketadi");
    }
    const due_date = 'due_date' in body ? parseDueDate(body.due_date) : current.due_date;
    const master_id = 'master_id' in body ? await resolveMasterId(t, body.master_id) : current.master_id;
    const status = statusFor(total_amount, paid_amount);

    const updated = await t
      .prepare(
        `UPDATE expenses SET item_name = ?, description = ?, supplier = ?, phone = ?, category = ?,
                             quantity = ?, unit = ?, unit_price = ?, total_amount = ?, currency = ?,
                             status = ?, due_date = ?, master_id = ?, updated_at = app_now()
         WHERE id = ? RETURNING ${EXPENSE_FIELDS}`
      )
      .one(
        item_name, description, supplier, phone, category, quantity, unit, unit_price, total_amount,
        currency, status, due_date, master_id, id
      );
    await audit(t, req, id, 'updated', { before: snapshot(current), after: snapshot(updated) });
    return updated;
  });

  if (!expense) return res.status(404).json({ error: 'Hisob topilmadi' });
  res.json({ expense: present(expense) });
});

/**
 * Records a payment against an expense.
 *
 * Runs in one transaction that re-reads the row FOR UPDATE, so two admins paying
 * at the same moment serialise instead of both computing a stale remainder. The
 * payment inherits the expense's currency -- a UZS expense cannot be paid in USD.
 */
router.post('/:id/payments', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};

  const expense = await db.transaction(async (t) => {
    const current = await t.prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses WHERE id = ? FOR UPDATE`).one(id);
    if (!current) {
      const err = new Error('Hisob topilmadi');
      err.status = 404;
      throw err;
    }
    if (current.deleted_at) throw archivedOnly();

    if (body.currency !== undefined && body.currency !== null && body.currency !== '') {
      const requested = normalizeCurrency(body.currency, { required: true });
      if (requested !== current.currency) throw badRequest("To'lov valyutasi hisob valyutasiga mos kelishi kerak");
    }

    const amount = parseMoney(body.amount, "To'lov", current.currency);
    if (amount <= 0) throw badRequest("To'lov summasi 0 dan katta bo'lishi kerak");
    const note = text(body.note, 'Izoh', { max: 1000 });

    const remaining = Number(current.remaining_amount);
    if (amount > remaining) {
      throw badRequest(`To'lov qoldiq summadan (${remaining} ${moneySymbol(current.currency)}) katta bo'lishi mumkin emas`);
    }

    const paid = Number(current.paid_amount) + amount;
    const status = statusFor(Number(current.total_amount), paid);

    await t
      .prepare('INSERT INTO expense_payments (expense_id, amount, currency, note, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(id, amount, current.currency, note, req.user.id);

    const updated = await t
      .prepare('UPDATE expenses SET paid_amount = ?, status = ?, updated_at = app_now() WHERE id = ? RETURNING ' + EXPENSE_FIELDS)
      .one(paid, status, id);

    await audit(t, req, id, 'payment_added', {
      amount,
      currency: current.currency,
      note,
      total_amount: Number(updated.total_amount),
      paid_amount: Number(updated.paid_amount),
      remaining_amount: Number(updated.remaining_amount),
      status: updated.status,
    });
    return updated;
  });

  res.status(201).json({ expense: present(expense) });
});

/**
 * Voids a mistaken payment. The row is never deleted: it is stamped and the
 * parent's paid_amount is recomputed from the remaining live rows, so the ledger
 * still reconciles and the mistake stays on record.
 */
router.post('/:id/payments/:paymentId/void', async (req, res) => {
  const id = Number(req.params.id);
  const paymentId = Number(req.params.paymentId);
  const body = req.body || {};
  const reason = text(body.reason, 'Sabab', { required: true, max: 500 });

  const expense = await db.transaction(async (t) => {
    const current = await t.prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses WHERE id = ? FOR UPDATE`).one(id);
    if (!current) {
      const err = new Error('Hisob topilmadi');
      err.status = 404;
      throw err;
    }
    if (current.deleted_at) throw archivedOnly();

    const payment = await t
      .prepare('SELECT id, amount, voided_at FROM expense_payments WHERE id = ? AND expense_id = ? FOR UPDATE')
      .one(paymentId, id);
    if (!payment) {
      const err = new Error("To'lov topilmadi");
      err.status = 404;
      throw err;
    }
    if (payment.voided_at) {
      const err = new Error("Bu to'lov allaqachon bekor qilingan");
      err.status = 409;
      throw err;
    }

    await t
      .prepare('UPDATE expense_payments SET voided_at = app_now(), voided_by = ?, void_reason = ? WHERE id = ?')
      .run(req.user.id, reason, paymentId);

    const sum = await t
      .prepare('SELECT COALESCE(SUM(amount), 0) s FROM expense_payments WHERE expense_id = ? AND voided_at IS NULL')
      .get(id);
    const paid = Number(sum.s);
    const status = statusFor(Number(current.total_amount), paid);

    const updated = await t
      .prepare('UPDATE expenses SET paid_amount = ?, status = ?, updated_at = app_now() WHERE id = ? RETURNING ' + EXPENSE_FIELDS)
      .one(paid, status, id);

    await audit(t, req, id, 'payment_voided', {
      payment_id: paymentId,
      amount: Number(payment.amount),
      reason,
      paid_amount: Number(updated.paid_amount),
      remaining_amount: Number(updated.remaining_amount),
      status: updated.status,
    });
    return updated;
  });

  res.json({ expense: present(expense) });
});

/**
 * Marks the expense fully settled. A payment row is inserted for the remainder
 * so SUM(live payments) still equals paid_amount.
 */
router.post('/:id/mark-paid', async (req, res) => {
  const id = Number(req.params.id);
  const expense = await db.transaction(async (t) => {
    const current = await t.prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses WHERE id = ? FOR UPDATE`).one(id);
    if (!current) {
      const err = new Error('Hisob topilmadi');
      err.status = 404;
      throw err;
    }
    if (current.deleted_at) throw archivedOnly();

    const outstanding = Number(current.remaining_amount);
    if (outstanding > 0) {
      await t
        .prepare('INSERT INTO expense_payments (expense_id, amount, currency, note, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(id, outstanding, current.currency, "Hisob to'liq to'langan deb belgilandi", req.user.id);
    }

    const updated = await t
      .prepare("UPDATE expenses SET paid_amount = total_amount, status = 'paid', updated_at = app_now() WHERE id = ? RETURNING " + EXPENSE_FIELDS)
      .one(id);
    await audit(t, req, id, 'marked_paid', { settled_amount: outstanding, ...snapshot(updated) });
    return updated;
  });

  res.json({ expense: present(expense) });
});

/**
 * Soft delete (archive). Checks, all server-side:
 *   session (super_admin) -> rate limit -> exists -> fully paid -> pass key.
 * The row is never removed; deleted_at is stamped so the history stays queryable.
 */
router.delete('/:id', rateLimit.debtDeleteRateLimit, async (req, res) => {
  const id = Number(req.params.id);

  const current = await db.prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses WHERE id = ?`).get(id);
  if (!current) return res.status(404).json({ error: 'Hisob topilmadi' });
  if (current.deleted_at) return res.status(409).json({ error: 'Bu hisob allaqachon arxivlangan' });
  if (Number(current.remaining_amount) > 0) throw paidOnly();

  await auditStandalone(req, id, 'delete_requested', snapshot(current));

  try {
    deletePassKeyOk(req);
  } catch (e) {
    await auditStandalone(req, id, 'delete_denied', { status: e.status, reason: e.message });
    throw e;
  }

  const archived = await db.transaction(async (t) => {
    const locked = await t.prepare(`SELECT ${EXPENSE_FIELDS} FROM expenses WHERE id = ? FOR UPDATE`).one(id);
    if (!locked) {
      const err = new Error('Hisob topilmadi');
      err.status = 404;
      throw err;
    }
    if (locked.deleted_at) return null;
    if (Number(locked.remaining_amount) > 0) throw paidOnly();

    const row = await t
      .prepare('UPDATE expenses SET deleted_at = app_now(), deleted_by = ?, updated_at = app_now() WHERE id = ? RETURNING ' + EXPENSE_FIELDS)
      .one(req.user.id, id);
    await audit(t, req, id, 'deleted', snapshot(row));
    return row;
  });

  if (!archived) return res.status(409).json({ error: 'Bu hisob allaqachon arxivlangan' });

  rateLimit.recordDebtDeleteSuccess(req);
  res.json({ ok: true, expense: archived });
});

module.exports = { router, STATUS_UZ, CATEGORY_UZ };
