'use strict';

/**
 * Shared helpers for the customer/vehicle layer.
 *
 * Work orders and appointments accept both a selected `customer_id` /
 * `vehicle_id` and the legacy free-text snapshot fields. Keeping the
 * find-or-create rules here means those two entry points cannot produce two
 * different customer rows for the same person.
 */

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function text(value, field, { required = false, max = 500 } = {}) {
  const v = String(value == null ? '' : value).trim();
  if (required && !v) throw badRequest(`${field} to'ldirilishi shart`);
  if (v.length > max) throw badRequest(`${field} juda uzun`);
  return v;
}

function positiveId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalize(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
}

async function findCustomer(runner, id) {
  const n = positiveId(id);
  if (!n) return null;
  return runner.prepare('SELECT * FROM customers WHERE id = ?').get(n);
}

async function findVehicle(runner, id) {
  const n = positiveId(id);
  if (!n) return null;
  return runner.prepare('SELECT * FROM vehicles WHERE id = ?').get(n);
}

async function findOrCreateCustomer(runner, input, actor) {
  const full_name = text(input.full_name, 'Mijoz ismi', { max: 150 });
  const phone = text(input.phone, 'Mijoz telefoni', { max: 40 });
  const email = text(input.email, 'Email', { max: 160 });
  const address = text(input.address, 'Manzil', { max: 500 });
  const notes = text(input.notes, 'Izoh', { max: 2000 });
  if (!full_name && !phone) return null;

  const existing = await runner
    .prepare(
      `SELECT * FROM customers
        WHERE lower(btrim(full_name)) = lower(btrim(?))
          AND lower(btrim(phone)) = lower(btrim(?))
        ORDER BY id ASC LIMIT 1`
    )
    .get(full_name, phone);
  if (existing) return existing;

  return runner
    .prepare(
      `INSERT INTO customers (full_name, phone, email, address, notes, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       RETURNING *`
    )
    .one(full_name || phone, phone, email, address, notes);
}

async function findOrCreateVehicle(runner, input, customerId) {
  const customer_id = positiveId(customerId);
  if (!customer_id) return null;
  const brand = text(input.brand, 'Avtomobil markasi', { max: 80 });
  const model = text(input.model, 'Avtomobil modeli', { max: 80 });
  const plate_number = text(input.plate_number, 'Davlat raqami', { max: 30 });
  const vin = text(input.vin, 'VIN', { max: 40 });
  const color = text(input.color, 'Rang', { max: 40 });
  const yearRaw = input.year === '' || input.year == null ? null : Number(input.year);
  const year = Number.isInteger(yearRaw) && yearRaw >= 1886 && yearRaw <= 2200 ? yearRaw : null;
  if (!brand && !model && !plate_number && !vin) return null;

  const existing = await runner
    .prepare(
      `SELECT * FROM vehicles
        WHERE customer_id = ?
          AND lower(btrim(brand)) = lower(btrim(?))
          AND lower(btrim(model)) = lower(btrim(?))
          AND lower(btrim(plate_number)) = lower(btrim(?))
        ORDER BY id ASC LIMIT 1`
    )
    .get(customer_id, brand, model, plate_number);
  if (existing) return existing;

  return runner
    .prepare(
      `INSERT INTO vehicles (customer_id, brand, model, year, plate_number, vin, color, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       RETURNING *`
    )
    .one(customer_id, brand, model, year, plate_number, vin, color);
}

function customerSnapshot(customer) {
  return {
    customer_name: customer.full_name || '',
    customer_phone: customer.phone || '',
  };
}

function vehicleSnapshot(vehicle) {
  return {
    car_brand: vehicle.brand || '',
    car_model: vehicle.model || '',
    car_number: vehicle.plate_number || '',
  };
}

module.exports = {
  badRequest,
  text,
  positiveId,
  normalize,
  findCustomer,
  findVehicle,
  findOrCreateCustomer,
  findOrCreateVehicle,
  customerSnapshot,
  vehicleSnapshot,
};
