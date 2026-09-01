import pg from 'pg';
import { databaseSslFrom } from '../../store-factory.js';
import { TokenCipher } from './token-cipher.js';

const { Pool } = pg;

export function createBitrixInstallationStore(environment = process.env) {
  if (!environment.BITRIX_TOKEN_ENCRYPTION_KEY) return null;
  if (!environment.DATABASE_URL) {
    throw new Error('Для хранения установок Bitrix24 задайте DATABASE_URL.');
  }
  const cipher = new TokenCipher(environment.BITRIX_TOKEN_ENCRYPTION_KEY);
  return new PostgresBitrixInstallationStore(environment.DATABASE_URL, cipher, databaseSslFrom(environment));
}

export class PostgresBitrixInstallationStore {
  constructor(connectionString, cipher, ssl) {
    this.pool = new Pool({ connectionString, ssl, max: 3, idleTimeoutMillis: 30_000 });
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
