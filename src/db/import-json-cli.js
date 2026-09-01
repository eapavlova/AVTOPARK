import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createEmptyState } from '../domain.js';
import { runMigrations } from './migrate.js';
import { PostgresStore } from '../postgres-store.js';

const sourceFile = process.env.JSON_IMPORT_FILE;
const connectionString = process.env.DATABASE_URL;
const replace = process.argv.includes('--replace');

if (!sourceFile) throw new Error('Задайте JSON_IMPORT_FILE с путем к прежнему файлу данных.');
if (!connectionString) throw new Error('Задайте DATABASE_URL.');

const parsed = JSON.parse(await readFile(sourceFile, 'utf8'));
const state = normalizeState(parsed);
const { Pool } = pg;
const pool = new Pool({ connectionString, max: 1 });

try {
  await runMigrations(pool);
  const existing = await pool.query('select exists(select 1 from app_metadata where singleton = true) as initialized');
  if (existing.rows[0]?.initialized && !replace) {
    throw new Error('База уже содержит данные. Для намеренной полной замены добавьте --replace.');
  }
} finally {
  await pool.end();
}

const store = await PostgresStore.connect({ connectionString, seedDemo: false });
try {
  await store.replace(state);
  console.log('Данные из JSON перенесены в PostgreSQL. Файл JSON не удалялся.');
} finally {
  await store.close();
}

function normalizeState(input) {
  const empty = createEmptyState();
  return {
    ...empty,
    ...input,
    meta: { ...empty.meta, ...input.meta },
    counters: { ...empty.counters, ...input.counters },
    users: input.users ?? [],
    vehicles: input.vehicles ?? [],
    assignments: input.assignments ?? [],
    transfers: input.transfers ?? [],
    transferFiles: input.transferFiles ?? [],
    waybills: (input.waybills ?? []).map((waybill) => ({ route: '', note: '', ...waybill })),
    waybillRevisions: input.waybillRevisions ?? [],
    waybillFiles: input.waybillFiles ?? [],
    notifications: input.notifications ?? [],
    vehicleSyncs: input.vehicleSyncs ?? [],
    auditLog: input.auditLog ?? []
  };
}
