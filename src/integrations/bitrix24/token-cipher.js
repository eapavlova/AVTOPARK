import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class TokenCipher {
  constructor(secret) {
    if (typeof secret !== 'string' || secret.length < 32) {
      throw new Error('BITRIX_TOKEN_ENCRYPTION_KEY должен содержать не менее 32 символов.');
    }
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }

  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      value: encrypted.toString('base64')
    });
  }

  decrypt(serialized) {
    const payload = JSON.parse(serialized);
    if (payload.version !== 1) throw new Error('Неизвестная версия шифрования токенов.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.value, 'base64')),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  }
}
