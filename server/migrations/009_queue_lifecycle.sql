ALTER TABLE work_logs
  ADD COLUMN IF NOT EXISTS scheduled_time TEXT NOT NULL DEFAULT '';

ALTER TABLE work_logs
  DROP CONSTRAINT IF EXISTS work_logs_status_check;

ALTER TABLE work_logs
  ADD CONSTRAINT work_logs_status_check
  CHECK (status IN ('Kutilayotgan', 'Jarayonda', 'Tugallangan', 'Bekor qilingan'));
