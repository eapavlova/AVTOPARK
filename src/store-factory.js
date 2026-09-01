import { PostgresStore } from './postgres-store.js';

export async function createStore(environment = process.env) {
  if (!environment.DATABASE_URL) {
    throw new Error('Задайте DATABASE_URL: Autopark использует только PostgreSQL.');
  }
  return PostgresStore.connect({
    connectionString: environment.DATABASE_URL,
    seedDemo: environment.SEED_DEMO_DATA === 'true',
    ssl: databaseSslFrom(environment)
  });
}

export function databaseSslFrom(environment) {
  const value = String(environment.DATABASE_SSL ?? '').toLowerCase();
  if (!value || value === 'false' || value === 'disable') return undefined;
  if (value === 'true' || value === 'require') return { rejectUnauthorized: false };
  if (value === 'verify-full') return { rejectUnauthorized: true };
  throw new Error('DATABASE_SSL может иметь значения disable, require или verify-full.');
}
