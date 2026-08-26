import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PostgreSQL migration contains critical fleet invariants and query indexes', async () => {
  const sql = await readFile(new URL('../migrations/001_initial_schema.sql', import.meta.url), 'utf8');

  assert.match(sql, /assignments_one_open_per_vehicle_idx/i);
  assert.match(sql, /vehicle_transfers_one_pending_per_vehicle_idx/i);
  assert.match(sql, /enforce_ordinary_driver_assignment_limit/i);
  assert.match(sql, /waybills_vehicle_date_idx/i);
  assert.match(sql, /waybills_accounting_queue_idx/i);
  assert.match(sql, /references users\(id\)/i);
});

test('Bitrix24 installation migration stores only an encrypted token bundle', async () => {
  const sql = await readFile(new URL('../migrations/002_bitrix_installations.sql', import.meta.url), 'utf8');

  assert.match(sql, /token_bundle text not null/i);
  assert.doesNotMatch(sql, /access_token\s+text|refresh_token\s+text/i);
});

test('notification outbox migration supports durable retry delivery', async () => {
  const sql = await readFile(new URL('../migrations/003_notification_outbox.sql', import.meta.url), 'utf8');

  assert.match(sql, /status in \('PENDING', 'SENT', 'FAILED'\)/i);
  assert.match(sql, /attempts integer not null/i);
  assert.match(sql, /notification_outbox_pending_idx/i);
});

test('waybill revision migration stores before and after snapshots', async () => {
  const sql = await readFile(new URL('../migrations/004_waybill_revisions.sql', import.meta.url), 'utf8');

  assert.match(sql, /before_data jsonb not null/i);
  assert.match(sql, /after_data jsonb not null/i);
  assert.match(sql, /references waybills\(id\)/i);
  assert.match(sql, /waybill_revisions_waybill_created_idx/i);
});

test('vehicle synchronization outbox migration supports durable delivery', async () => {
  const sql = await readFile(new URL('../migrations/005_vehicle_sync_outbox.sql', import.meta.url), 'utf8');

  assert.match(sql, /references vehicles\(id\)/i);
  assert.match(sql, /status in \('PENDING', 'SENT', 'FAILED'\)/i);
  assert.match(sql, /vehicle_sync_outbox_pending_idx/i);
});

test('waybill file migration stores private keys and enforces size limits', async () => {
  const sql = await readFile(new URL('../migrations/006_waybill_files.sql', import.meta.url), 'utf8');

  assert.match(sql, /references waybills\(id\)/i);
  assert.match(sql, /storage_key text not null unique/i);
  assert.match(sql, /size_bytes <= 10485760/i);
  assert.match(sql, /waybill_files_waybill_created_idx/i);
});
