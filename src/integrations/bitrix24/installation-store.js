import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { TokenCipher } from './token-cipher.js';

const { Pool } = pg;

export function createBitrixInstallationStore(environment = process.env) {
  if (!environment.BITRIX_TOKEN_ENCRYPTION_KEY) return null;
  const cipher = new TokenCipher(environment.BITRIX_TOKEN_ENCRYPTION_KEY);
  const driver = environment.STORAGE_DRIVER ?? (environment.DATABASE_URL ? 'postgres' : 'json');
  if (driver === 'postgres') {
    return new PostgresBitrixInstallationStore(environment.DATABASE_URL, cipher);
  }
  return new FileBitrixInstallationStore(environment.BITRIX_AUTH_FILE, cipher);
}

export class FileBitrixInstallationStore {
  constructor(filePath = './data/bitrix-installations.enc.json', cipher) {
    this.filePath = resolve(filePath);
    this.cipher = cipher;
    this.pendingUpdate = Promise.resolve();
  }

  async get(memberId) {
    const records = await this.loadRecords();
    const record = records[memberId];
    return record ? { ...record, ...this.cipher.decrypt(record.tokenBundle), tokenBundle: undefined } : null;
  }

  async save(installation) {
    const operation = this.pendingUpdate.then(async () => {
      const records = await this.loadRecords();
      const now = new Date().toISOString();
      records[installation.memberId] = {
        memberId: installation.memberId,
        domain: installation.domain,
        expiresAt: installation.expiresAt ?? null,
        installedByBitrixUserId: installation.installedByBitrixUserId ?? null,
        installedAt: records[installation.memberId]?.installedAt ?? now,
        updatedAt: now,
        tokenBundle: this.cipher.encrypt({
          accessToken: installation.accessToken,
          refreshToken: installation.refreshToken
        })
      };
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
      return this.get(installation.memberId);
    });
    this.pendingUpdate = operation.catch(() => undefined);
    return operation;
  }

  async loadRecords() {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
}

export class PostgresBitrixInstallationStore {
  constructor(connectionString, cipher) {
    this.pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000 });
    this.cipher = cipher;
  }

  async get(memberId) {
    const result = await this.pool.query('select * from bitrix_installations where member_id = $1', [memberId]);
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      memberId: row.member_id,
      domain: row.domain,
      expiresAt: row.expires_at?.toISOString() ?? null,
      installedByBitrixUserId: row.installed_by_bitrix_user_id === null ? null : Number(row.installed_by_bitrix_user_id),
      installedAt: row.installed_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      ...this.cipher.decrypt(row.token_bundle)
    };
  }

  async save(installation) {
    const tokenBundle = this.cipher.encrypt({
      accessToken: installation.accessToken,
      refreshToken: installation.refreshToken
    });
    await this.pool.query(`
      insert into bitrix_installations (
        member_id, domain, token_bundle, expires_at, installed_by_bitrix_user_id, installed_at, updated_at
      ) values ($1, $2, $3, $4, $5, now(), now())
      on conflict (member_id) do update set
        domain = excluded.domain,
        token_bundle = excluded.token_bundle,
        expires_at = excluded.expires_at,
        installed_by_bitrix_user_id = excluded.installed_by_bitrix_user_id,
        updated_at = now()
    `, [
      installation.memberId,
      installation.domain,
      tokenBundle,
      installation.expiresAt ?? null,
      installation.installedByBitrixUserId ?? null
    ]);
    return this.get(installation.memberId);
  }

  async close() {
    await this.pool.end();
  }
}
