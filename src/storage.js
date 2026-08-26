import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInitialState, seedDemoState } from './domain.js';

export class JsonStore {
  constructor(filePath) {
    this.filePath = resolve(filePath ?? './data/autopark.json');
    this.pendingUpdate = Promise.resolve();
  }

  async load() {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const state = JSON.parse(content);
      return {
        ...state,
        waybillRevisions: state.waybillRevisions ?? [],
        waybillFiles: state.waybillFiles ?? [],
        notifications: state.notifications ?? [],
        vehicleSyncs: state.vehicleSyncs ?? [],
        counters: { waybillRevision: 0, waybillFile: 0, notification: 0, vehicleSync: 0, ...state.counters }
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const state = seedDemoState();
      await this.save(state);
      return state;
    }
  }

  async save(state) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async reset() {
    const state = createInitialState();
    await this.save(state);
    return state;
  }

  async update(mutator) {
    const operation = this.pendingUpdate.then(async () => {
      const state = await this.load();
      const nextState = await mutator(state);
      await this.save(nextState);
      return nextState;
    });
    this.pendingUpdate = operation.catch(() => undefined);
    return operation;
  }
}
