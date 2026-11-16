import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonAlertStore } from './alertStore.js';

describe('createJsonAlertStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alert-store-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates directory if missing and returns empty list when alerts.json does not exist', async () => {
    const nestedDir = path.join(tempDir, 'nested', 'data');
    const store = createJsonAlertStore(nestedDir);

    expect(await store.list()).toEqual([]);

    const created = await store.create({ query: 'RTX 4070', targetPrice: 3500 });
    expect(created.id).toBe('1');
    expect(created.query).toBe('RTX 4070');
    expect(created.targetPrice).toBe(3500);
    expect(created.active).toBe(true);
    expect(created.lastCheckedAt).toBeNull();
    expect(created.lastPrice).toBeNull();
    expect(created.lowestPrice).toBeNull();
    expect(created.lastNotifiedAt).toBeNull();

    const fileExists = await fs
      .access(path.join(nestedDir, 'alerts.json'))
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('creates, lists, filters active, gets by id, updates, and removes alerts', async () => {
    const store = createJsonAlertStore(tempDir);

    const a1 = await store.create({ query: 'Airfryer Philips', targetPrice: 400 });
    const a2 = await store.create({ query: 'Kindle Paperwhite' });

    expect(a1.id).toBe('1');
    expect(a2.id).toBe('2');
    expect(a2.targetPrice).toBeNull();

    const all = await store.list();
    expect(all).toHaveLength(2);

    const fetched = await store.getById('1');
    expect(fetched?.query).toBe('Airfryer Philips');

    const updated = await store.update('2', { active: false, lastPrice: 699 });
    expect(updated?.active).toBe(false);
    expect(updated?.lastPrice).toBe(699);

    const active = await store.listActive();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('1');

    const removed = await store.remove('1');
    expect(removed).toBe(true);
    expect(await store.getById('1')).toBeUndefined();
    expect(await store.list()).toHaveLength(1);

    const a3 = await store.create({ query: 'SSD 1TB' });
    expect(a3.id).toBe('3');
  });

  it('persists data across separate store instances', async () => {
    const storeA = createJsonAlertStore(tempDir);
    await storeA.create({ query: 'Monitor 27 144Hz', targetPrice: 1200 });
    await storeA.update('1', { lastPrice: 1350, lowestPrice: 1350 });

    const storeB = createJsonAlertStore(tempDir);
    const list = await storeB.list();
    expect(list).toHaveLength(1);
    expect(list[0].query).toBe('Monitor 27 144Hz');
    expect(list[0].lastPrice).toBe(1350);

    const next = await storeB.create({ query: 'Teclado Mecanico' });
    expect(next.id).toBe('2');
  });

  it('serializes concurrent writes without corrupting alerts.json', async () => {
    const store = createJsonAlertStore(tempDir);

    const creations = Array.from({ length: 15 }, (_, index) =>
      store.create({ query: `Produto ${index + 1}`, targetPrice: 100 + index }),
    );
    const created = await Promise.all(creations);

    const ids = created.map((item) => item.id);
    expect(new Set(ids).size).toBe(15);

    const list = await store.list();
    expect(list).toHaveLength(15);
  });

  it('handles non-existent IDs and corrupted alerts.json safely', async () => {
    const store = createJsonAlertStore(tempDir);

    expect(await store.getById('999')).toBeUndefined();
    expect(await store.update('999', { active: false })).toBeUndefined();
    expect(await store.remove('999')).toBe(false);

    await fs.writeFile(path.join(tempDir, 'alerts.json'), '{not valid json!!!', 'utf-8');
    expect(await store.list()).toEqual([]);

    await fs.writeFile(path.join(tempDir, 'alerts.json'), '{"not":"an array"}', 'utf-8');
    expect(await store.list()).toEqual([]);

    const recovered = await store.create({ query: 'Fone Bluetooth', targetPrice: 250 });
    expect(recovered.id).toBe('1');
  });
});
