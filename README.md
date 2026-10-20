# Amper Avto Elektro

Avtomobil elektr tizimlarini tashxislash va ta'mirlash ustaxonasi uchun sayt va boshqaruv paneli.

Sayt: [amper.uz](https://amper.uz)

## Xizmatlar

- Elektrodiagnostika
- Elektr simlari
- Starter va generator
- Akkumulyator
- Yoritish tizimi
- ECU va sensorlar

## Stack

- **Backend:** Node.js + Express + PostgreSQL, JWT session cookie, bcrypt
- **Frontend:** React 18 + Vite + Tailwind CSS
- **Fayllar:** S3-compatible object storage (Cloudflare R2)
- **Modullar:** rolga asoslangan boshqaruv (super admin / usta), usta arizalari,
  xizmatlar katalogi, navbat va ish holatlari, bajarilgan ishlar galereyasi,
  qarz daftari va to'lovlar, ombor, xarajatlar, UZS/USD hisob-kitob.

## Ishga tushirish

Talab: Node.js 24 va PostgreSQL.

```bash
# bog'liqliklarni o'rnatish (repo ildizida)
npm install

# server (http://localhost:4000)
npm run dev --prefix server

# client (http://localhost:5173, /api -> localhost:4000)
npm run dev --prefix client
```

`server/.env.example` kerakli o'zgaruvchilarni ko'rsatadi. `DATABASE_URL` va
`JWT_SECRET` majburiy; R2 sozlanmasa, fayllar lokal `UPLOADS_DIR`ga yoziladi.

## Migratsiyalar va seed

Server ishga tushganda `server/migrations/*.sql` bir marta qo'llanadi va bo'sh
bazaga boshlang'ich sozlamalar hamda xizmatlar katalogi yoziladi.

```bash
npm run db:migrate --prefix server
```

`010_electric_service_catalog.sql` eski mexanik katalog xizmatlarini o'chiradi
emas, faqat faolsizlantiradi va elektr xizmatlarini qo'shadi. Tarixiy ish va
qarz yozuvlari o'z xizmat nomini saqlab qoladi.

## Build va testlar

```bash
npm run build
npm test
npm run test:prod
```

`npm test` vaqtinchalik PostgreSQL klasterini ko'taradi; alohida test bazasi
kerak emas.

## Production

Production uchun `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`,
`CLIENT_ORIGIN=https://amper.uz`, `SETUP_SECRET` va R2 kalitlari berilishi kerak.
Vercel kabi read-only fayl tizimida `DATA_DIR=/tmp/data` va
`UPLOADS_DIR=/tmp/uploads` ishlatiladi.

API hujjatlari: `docs/API_DOCUMENTATION.md` va `docs/openapi.yaml`.
