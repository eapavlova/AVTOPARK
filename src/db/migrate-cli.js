import pg from 'pg';
import { runMigrations } from './migrate.js';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Для миграций задайте переменную DATABASE_URL.');
}

const pool = new Pool({ connectionString, max: 2 });
try {
  await runMigrations(pool);
  console.log('Миграции PostgreSQL применены.');
} finally {
  await pool.end();
}
