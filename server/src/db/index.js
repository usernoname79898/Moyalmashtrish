const { pool, query, transaction, statement, toPgPlaceholders } = require('./pool');
const { withAdvisoryXactLock } = require('./advisory');

const { DEFAULT_SETTINGS, DEFAULT_MASTER_PERMISSIONS } = require('./defaults');

/**
 * Query facade.
 *
 * Call sites keep the familiar `db.prepare(sql).get(...)` shape so route code
 * stays readable; the methods are async because PostgreSQL has no synchronous API.
 * `?` placeholders are rewritten to `$n` automatically.
 *
 * SQLite-isms deliberately NOT emulated (they are ported properly instead):
 *   - `last_insert_rowid()`  -> `.one()` with `RETURNING id`
 *   - `INSERT OR REPLACE`    -> `INSERT ... ON CONFLICT ... DO UPDATE`
 *   - `datetime('now')`      -> `app_now()` (migrations/001_init.sql)
 *   - `BEGIN`/`COMMIT`       -> `db.transaction(async (t) => { ... })`
 */

// Opt-in statement counter (DB_TRACE_QUERIES=1) used by the N+1 regression test.
const stats = { count: 0, enabled: process.env.DB_TRACE_QUERIES === '1' };

function flatten(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function prepare(sql) {
  if (stats.enabled) stats.count++;
  const stmt = statement((text, params) => query(text, params), toPgPlaceholders(sql));
  // Accept both `stmt.get(a, b)` and `stmt.get([a, b])` so call sites can pass
  // spread params or a ready-made array.
  const wrap = (fn) => async (...params) => fn(flatten(params));
  return {
    sql: stmt.sql,
    get: wrap(stmt.get),
    all: wrap(stmt.all),
    run: wrap(stmt.run),
    /** For INSERT/UPDATE/DELETE ... RETURNING: resolves to the first row. */
    one: wrap(stmt.one),
  };
}

/** Statement with no parameters (schema checks, diagnostics). */
function prepareRaw(sql) {
  return {
    get: async () => (await query(sql)).rows[0],
    all: async () => (await query(sql)).rows,
  };
}

const counter = {
  get: () => stats.count,
  reset: () => {
    stats.count = 0;
  },
  enabled: () => stats.enabled,
};

// Exposed on `db` so the diagnostics route can read the counter without
// importing this module's internals.
const db = {
  prepare,
  prepareRaw,
  transaction,
  query,
  pool,
  __getQueryCount: counter.get,
  __resetQueryCount: counter.reset,
  __traceEnabled: counter.enabled,
};
/**
 * Advisory lock key for seeding.
 *
 * Distinct from the migration lock so a cold start never nests the two, and so
 * seeding stays serialised even though migrations release their lock first.
 *
 * Transaction-scoped, like the migration lock: a session lock would stay attached
 * to the pooled connection after `seed()` returned. See db/advisory.js.
 */
const SEED_LOCK_ID = 728411905518;

/**
 * Inserts the default settings and the default service catalogue.
 *
 * Safe on every cold start and safe to call concurrently: the transaction-scoped
 * lock makes the check-then-insert below atomic per database, and the settings
 * upsert is idempotent by primary key.
 *
 * The lock is preferred over a unique index on `services(sort_order)` because
 * admins can set arbitrary sort orders, so existing production data may already
 * contain duplicates. Creating a unique index over that data would fail and
 * block startup, whereas a lock never touches existing rows.
 *
 * Losing the race is not an error: another instance is seeding the same
 * idempotent defaults. The service catalogue is then filled on a later cold
 * start, and `/api/public/settings` already falls back to the defaults, so this
 * instance can serve requests either way.
 */
async function seed() {
  const client = await pool.connect();
  try {
    await withAdvisoryXactLock(
      client,
      SEED_LOCK_ID,
      async () => {
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          await client.query(
            toPgPlaceholders('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING'),
            [key, JSON.stringify(DEFAULT_SETTINGS[key])]
          );
        }

        const { rows } = await client.query('SELECT COUNT(*) AS c FROM services');
        if (Number(rows[0].c) === 0) {
          // The catalogue, not a hard-coded list of screens. This is an
          // auto-electrical workshop: the six services cover diagnostics, wiring,
          // starting/charging, batteries, lighting and electronic modules. Migration
          // 010 retires the previous mechanical catalogue on databases that already
          // carry it, and this list is what a new database gets.
          const services = [
            ['Elektrodiagnostika', 'Avtomobil elektr tizimlarini kompyuter diagnostikasi bilan tekshiramiz: xatolik kodlari, simlar va datchiklar.', 'Aniq xatolikni topish|Tezkor tashxis|To\'liq hisobot', '', 'diagnostic', '', 1],
            ['Elektr simlari', 'Simlar, ulanishlar va o\'tkazgichlarni ta\'mirlaymiz: uzilish, qisqa tutashuv va oksidlanish.', 'Uzilishni tez topish|Ishonchli ulanish|Kafolatli ta\'mir', '', 'bolt', '', 2],
            ['Starter va generator', 'Starter, generator va zaryadlash tizimini ta\'mirlash hamda almashtirish.', 'Ishonchli ishga tushish|Zaryadni tiklash|Tezkor ta\'mir', '', 'refresh', '', 3],
            ['Akkumulyator', 'Akkumulyatorni tekshirish, zaryadlash va almashtirish. Quvvat va kuchlanishni nazorat qilamiz.', 'Quvvatni tekshirish|Tez almashtirish|Maslahat va kafolat', '', 'battery', '', 4],
            ['Yoritish tizimi', 'Fara, stop, burilish chiroqlari va salon yoritgichlarini ta\'mirlash.', 'Yorug\'likni tiklash|To\'g\'ri ulanish|Xavfsiz haydash', '', 'light', '', 5],
            ['ECU va sensorlar', 'Dvigatel boshqaruv bloki, immobilayzer va datchiklarni diagnostika qilish va ta\'mirlash.', 'Elektron nosozliklarni topish|Dasturiy sozlash|Ishonchli ta\'mir', '', 'chip', '', 6],
          ];
          for (const s of services) {
            await client.query(
              toPgPlaceholders(
                'INSERT INTO services (name, description, benefits, image, icon, price, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
              ),
              s
            );
          }
        }
      },
      { name: 'seed' }
    );
  } catch (err) {
    // Only a lost race is tolerated; anything else (missing table, bad SQL) must
    // still fail startup loudly.
    if (err.code !== 'LOCK_BUSY') throw err;
    console.error('[db] seed skipped: ' + err.message);
  } finally {
    client.release();
  }
}

async function resetSettings() {
  await query('DELETE FROM settings');
  await seed();
}

module.exports = { db, counter, pool, query, transaction, prepare, DEFAULT_SETTINGS, DEFAULT_MASTER_PERMISSIONS, seed, resetSettings, SEED_LOCK_ID };
