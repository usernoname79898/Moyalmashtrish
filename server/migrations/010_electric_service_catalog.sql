-- 010_electric_service_catalog.sql
-- The workshop now specialises in auto-electrical work. The previous mechanical
-- catalogue is retired and the electrical six-service catalogue is offered.
--
-- Durability rules, same as every other migration here:
--   * no DROP, no TRUNCATE, no DELETE FROM services;
--   * old rows are deactivated, never removed, because `debts.service` and
--     `work_logs.service_type` store TEXT by value and the rows carry copy an
--     admin may have edited;
--   * every INSERT is guarded by WHERE NOT EXISTS, so re-running this file is a
--     no-op and cannot duplicate a service;
--   * rows that are already present keep their own copy, price and sort order;
--     only missing services are appended;
--   * a brand-new database still has an empty catalogue at this point (seed()
--     runs after migrations), so the gate stays closed and seed() inserts the
--     electrical catalogue itself.

-- 1. Retire the previous catalogue. Exact names only, so custom services an admin
--    added under other names are untouched. WHERE is_active = 1 keeps this
--    idempotent.
UPDATE services
   SET is_active = 0
 WHERE name IN ('Mator', 'Xodovoy', 'Diagnostika', 'Programma', 'Elektrik', 'Moy almashtirish')
   AND is_active = 1;

-- 2. Add the electrical catalogue. Rows are appended after the highest existing
--    sort_order instead of shifting what the admin has already arranged.
INSERT INTO services (name, description, benefits, image, icon, price, sort_order, is_active)
SELECT v.name,
       v.description,
       v.benefits,
       '', v.icon, '',
       (SELECT COALESCE(MAX(sort_order), 0) FROM services) + v.ord,
       1
  FROM (VALUES
    (1, 'Elektrodiagnostika',
        'Avtomobil elektr tizimlarini kompyuter diagnostikasi bilan tekshiramiz: xatolik kodlari, simlar va datchiklar.',
        'Aniq xatolikni topish|Tezkor tashxis|To''liq hisobot', 'diagnostic'),
    (2, 'Elektr simlari',
        'Simlar, ulanishlar va o''tkazgichlarni ta''mirlaymiz: uzilish, qisqa tutashuv va oksidlanish.',
        'Uzilishni tez topish|Ishonchli ulanish|Kafolatli ta''mir', 'bolt'),
    (3, 'Starter va generator',
        'Starter, generator va zaryadlash tizimini ta''mirlash hamda almashtirish.',
        'Ishonchli ishga tushish|Zaryadni tiklash|Tezkor ta''mir', 'refresh'),
    (4, 'Akkumulyator',
        'Akkumulyatorni tekshirish, zaryadlash va almashtirish. Quvvat va kuchlanishni nazorat qilamiz.',
        'Quvvatni tekshirish|Tez almashtirish|Maslahat va kafolat', 'battery'),
    (5, 'Yoritish tizimi',
        'Fara, stop, burilish chiroqlari va salon yoritgichlarini ta''mirlash.',
        'Yorug''likni tiklash|To''g''ri ulanish|Xavfsiz haydash', 'light'),
    (6, 'ECU va sensorlar',
        'Dvigatel boshqaruv bloki, immobilayzer va datchiklarni diagnostika qilish va ta''mirlash.',
        'Elektron nosozliklarni topish|Dasturiy sozlash|Ishonchli ta''mir', 'chip')
  ) AS v(ord, name, description, benefits, icon)
 WHERE EXISTS (SELECT 1 FROM services)
   AND NOT EXISTS (SELECT 1 FROM services s WHERE s.name = v.name);
