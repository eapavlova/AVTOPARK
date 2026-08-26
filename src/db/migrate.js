import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function runMigrations(pool, migrationsDir = resolve('migrations')) {
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query("select pg_advisory_lock(hashtext('autopark_schema_migrations'))");

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    const appliedResult = await client.query('select version from schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.version));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(resolve(migrationsDir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext('autopark_schema_migrations'))");
    } finally {
      client.release();
    }
  }
}
