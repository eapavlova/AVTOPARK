import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class LocalFileStore {
  constructor(rootDir = './data/files') {
    this.rootDir = resolve(rootDir);
  }

  async put(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Нельзя сохранить пустой файл.');
    await mkdir(this.rootDir, { recursive: true });
    const storageKey = randomUUID();
    await writeFile(this.#path(storageKey), buffer, { flag: 'wx' });
    return storageKey;
  }

  async read(storageKey) {
    return readFile(this.#path(storageKey));
  }

  async remove(storageKey) {
    await rm(this.#path(storageKey), { force: true });
  }

  #path(storageKey) {
    if (!/^[0-9a-f-]{36}$/i.test(storageKey)) throw new Error('Некорректный внутренний ключ файла.');
    return join(this.rootDir, storageKey);
  }
}
