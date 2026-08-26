import { PostgresStore } from './postgres-store.js';
import { JsonStore } from './storage.js';

export async function createStore(environment = process.env) {
  const driver = environment.STORAGE_DRIVER ?? (environment.DATABASE_URL ? 'postgres' : 'json');
  if (driver === 'postgres') {
    if (!environment.DATABASE_URL) {
      throw new Error('Для STORAGE_DRIVER=postgres задайте DATABASE_URL.');
    }
    return PostgresStore.connect({
      connectionString: environment.DATABASE_URL,
      seedDemo: environment.SEED_DEMO_DATA !== 'false'
    });
  }
  if (driver === 'json') {
    return new JsonStore(environment.DATA_FILE);
  }
  throw new Error(`Неизвестный STORAGE_DRIVER: ${driver}`);
}
