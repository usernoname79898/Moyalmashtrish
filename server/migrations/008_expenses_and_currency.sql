-- 008_expenses_and_currency.sql
--
-- Two related changes land together, because both touch money:
--
--   1. "Moy hisob-kitob": a supplier-credit ledger for anything the workshop
--      takes on credit or pays off in instalments -- oil, filters, parts,
--      services. It is modelled on the "Qarz daftari" (003): an append-only
--      payment ledger, an audit trail, a derived remaining amount and a soft
--      archive. The only additions are an explicit currency and the ability to
--      void a mistaken payment (recorded, never deleted).
--
--   2. A per-amount currency on every existing money field (UZS or USD), plus
--      the two floating-point/loose-type fixes the money rules require:
--        * work_logs.price was REAL -- floating point money, which drifts on
--          repeated addition. It becomes NUMERIC(14,2);
--        * debts / debt_payments stored whole so'm in BIGINT. They become
--          NUMERIC(14,2) so a USD amount keeps its cents exactly.
--
-- Durability rules for this file, same as every other migration here:
--   * no DROP TABLE, TRUNCATE or DELETE. The one `DROP COLUMN` below removes a
--     GENERATED STORED column, whose value is 100% derived from debt_amount -
--     paid_amount and is immediately recomputed by the `ADD COLUMN` that
--     follows it. No base value is read, moved or lost. It is necessary only
--     because PostgreSQL refuses `ALTER COLUMN ... TYPE` on a column used by a
--     generated column (verified: "cannot alter type of a column used by a
--     generated column");
--   * every currency column is added with IF NOT EXISTS and defaults to 'UZS',
--     which is exactly true: every amount already stored is a so'm amount. No
--     existing amount is changed by the default;
--   * type changes preserve every stored value: BIGINT -> NUMERIC(14,2) is
--     exact, and REAL -> NUMERIC(14,2) rounds to the nearest 0.01, which for
--     the whole-so'm prices already stored changes nothing;
--   * the whole file is idempotent: re-running it is a no-op.

-- ---------------------------------------------------------------------------
-- 1. currency columns on the existing money tables
-- ---------------------------------------------------------------------------
-- 'UZS' is the default for every existing row: the debt ledger, the warehouse
-- and the work journal have only ever stored so'm. Nothing is converted; a row
-- simply gains the currency it always implicitly had. No automatic conversion
-- between currencies exists anywhere -- a USD amount is always shown and summed
-- as USD, next to (never added to) a UZS amount.
ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UZS'
  CHECK (currency IN ('UZS', 'USD'));

ALTER TABLE work_logs
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UZS'
  CHECK (currency IN ('UZS', 'USD'));

ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UZS'
  CHECK (currency IN ('UZS', 'USD'));

ALTER TABLE debt_payments
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UZS'
  CHECK (currency IN ('UZS', 'USD'));

-- ---------------------------------------------------------------------------
-- 2. work_logs.price: REAL -> NUMERIC(14,2)
-- ---------------------------------------------------------------------------
-- REAL is a binary floating point type: 0.1 is not exact and repeated additions
-- drift, so a journal that cannot be added up exactly is worthless. NUMERIC is
-- exact. `USING round(price::numeric, 2)` keeps every existing whole so'm value
-- identical and rounds any stray fraction to the nearest qopik. Re-running is a
-- no-op: NUMERIC -> NUMERIC with the same USING expression is exact.
ALTER TABLE work_logs
  ALTER COLUMN price TYPE NUMERIC(14, 2) USING round(price::numeric, 2);

-- ---------------------------------------------------------------------------
-- 3. debts / debt_payments: BIGINT -> NUMERIC(14,2)
-- ---------------------------------------------------------------------------
-- BIGINT so'm cannot hold USD cents. NUMERIC(14,2) holds both exactly. The
-- guard makes the block a one-time conversion: once debt_amount is numeric the
-- whole body is skipped, so a re-run cannot drop and rebuild the column again.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'debts'
       AND column_name = 'debt_amount'
       AND data_type = 'bigint'
  ) THEN
    -- The derived column must go first: PostgreSQL refuses to change
    -- debt_amount's type while remaining_amount's expression depends on it.
    -- It holds no independent data -- it is recomputed below -- so this loses
    -- nothing. Its index comes back at the end of this section.
    ALTER TABLE debts DROP COLUMN IF EXISTS remaining_amount;

    ALTER TABLE debts
      ALTER COLUMN debt_amount TYPE NUMERIC(14, 2) USING debt_amount::numeric(14, 2);
    ALTER TABLE debts
      ALTER COLUMN paid_amount TYPE NUMERIC(14, 2) USING paid_amount::numeric(14, 2);

    -- Same definition as 003, now numeric. Still GENERATED ALWAYS, so a stored
    -- remainder still cannot drift from debt_amount - paid_amount.
    ALTER TABLE debts
      ADD COLUMN remaining_amount NUMERIC(14, 2)
      GENERATED ALWAYS AS (debt_amount - paid_amount) STORED;
  END IF;
END $$;

-- Recreated if the DROP above removed it (a dependent index is dropped with its
-- column); IF NOT EXISTS makes this a no-op otherwise.
CREATE INDEX IF NOT EXISTS idx_debts_remaining ON debts(remaining_amount DESC);

-- No generated column depends on debt_payments.amount, so it converts directly,
-- and the statement is a no-op once the column is numeric.
ALTER TABLE debt_payments
  ALTER COLUMN amount TYPE NUMERIC(14, 2) USING amount::numeric(14, 2);

-- ---------------------------------------------------------------------------
-- 4. expenses -- one row per item/service taken on credit or paid off.
-- ---------------------------------------------------------------------------
-- `total_amount` is the authoritative debt. `quantity` / `unit` / `unit_price`
-- are how the operator arrived at it and are kept for the printed record; the
-- total is what is owed, so a negotiated total that does not equal
-- quantity x unit_price is accepted rather than refused.
--
-- `remaining_amount` is GENERATED, exactly like debts.remaining_amount, so a
-- client-supplied remainder is impossible to store.
--
-- `currency` is fixed at creation and never converted. A payment must match it
-- (enforced in the API), so a UZS expense can only be paid down in so'm.
CREATE TABLE IF NOT EXISTS expenses (
  id                INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  item_name         TEXT NOT NULL CHECK (length(btrim(item_name)) > 0),
  description       TEXT NOT NULL DEFAULT '',
  -- Who the workshop owes. Free text: suppliers are not a table here, and a
  -- one-off seller is a legitimate creditor.
  supplier          TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  -- Broad bucket for filtering: 'oil' | 'filter' | 'service' | 'other'.
  category          TEXT NOT NULL DEFAULT 'other'
                      CHECK (category IN ('oil', 'filter', 'service', 'other')),
  quantity          NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit              TEXT NOT NULL DEFAULT 'dona',
  unit_price        NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total_amount      NUMERIC(14, 2) NOT NULL CHECK (total_amount > 0),
  paid_amount       NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  remaining_amount  NUMERIC(14, 2)
                      GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  currency          TEXT NOT NULL DEFAULT 'UZS' CHECK (currency IN ('UZS', 'USD')),
  status            TEXT NOT NULL DEFAULT 'unpaid'
                      CHECK (status IN ('unpaid', 'partially_paid', 'paid')),
  -- Free text 'YYYY-MM-DD' or ''; not a real DATE so it matches the TEXT
  -- timestamps used everywhere else and accepts an empty due date.
  due_date          TEXT NOT NULL DEFAULT '',
  -- Optional link to the ustа responsible for the purchase. SET NULL, never
  -- CASCADE: removing a user must not remove a money record.
  master_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT app_now(),
  updated_at        TEXT NOT NULL DEFAULT app_now(),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Soft delete, same as debts: NULL means live, a timestamp means archived.
  deleted_at        TEXT,
  deleted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT expenses_paid_not_over_total CHECK (paid_amount <= total_amount),
  -- Status is kept consistent with the amounts by the application inside the
  -- same transaction that writes a payment; this is the last line of defence.
  CONSTRAINT expenses_status_matches_amounts CHECK (
    (status = 'paid' AND total_amount - paid_amount = 0)
    OR (status = 'partially_paid' AND paid_amount > 0 AND total_amount - paid_amount > 0)
    OR (status = 'unpaid' AND paid_amount = 0)
  )
);

-- ---------------------------------------------------------------------------
-- 5. expense_payments -- append-only ledger of every payment, never deleted.
-- ---------------------------------------------------------------------------
-- A mistaken payment is *voided*, not removed: voided_at / voided_by / void_reason
-- stamp it, the row stays in the table and in the history, and the parent's
-- paid_amount is recomputed from the still-live rows in the same transaction.
-- So the ledger always reconciles (SUM of live payments = paid_amount) and the
-- mistake remains on record for the audit trail.
--
-- `expense_id` is ON DELETE RESTRICT for the same reason debt_payments uses it:
-- an expense that ever received money is archived, never removed.
CREATE TABLE IF NOT EXISTS expense_payments (
  id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  amount      NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL DEFAULT 'UZS' CHECK (currency IN ('UZS', 'USD')),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT app_now(),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at   TEXT,
  voided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- 6. expense_audit_logs -- who did what to which expense, and when.
-- ---------------------------------------------------------------------------
-- `expense_id` is deliberately NOT a foreign key, exactly like debt_audit_logs:
-- an audit trail that disappears with the record it describes is worthless.
-- The delete pass key is never written here; a refused delete is recorded as
-- delete_denied with only the status and reason.
CREATE TABLE IF NOT EXISTS expense_audit_logs (
  id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  expense_id  BIGINT,
  action      TEXT NOT NULL
                CHECK (action IN ('created', 'updated', 'payment_added',
                                  'payment_voided', 'marked_paid',
                                  'delete_requested', 'delete_denied', 'deleted')),
  admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_name  TEXT NOT NULL DEFAULT '',
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT app_now()
);

-- ---------------------------------------------------------------------------
-- 7. Indexes
-- ---------------------------------------------------------------------------
-- The list view is "live rows only, newest first", so a composite index covers
-- the default query; the per-column ones cover the filters the UI offers.
CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at);
CREATE INDEX IF NOT EXISTS idx_expenses_list ON expenses(deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_currency ON expenses(currency);
CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(lower(supplier));
CREATE INDEX IF NOT EXISTS idx_expenses_item_name ON expenses(lower(item_name));
CREATE INDEX IF NOT EXISTS idx_expenses_master ON expenses(master_id);
CREATE INDEX IF NOT EXISTS idx_expenses_remaining ON expenses(remaining_amount DESC);

CREATE INDEX IF NOT EXISTS idx_expense_payments_expense
  ON expense_payments(expense_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_audit_expense ON expense_audit_logs(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_audit_created ON expense_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_audit_action ON expense_audit_logs(action);
