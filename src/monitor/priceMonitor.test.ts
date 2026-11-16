import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonAlertStore } from '../storage/alertStore.js';
import type { AlertTriggerEvent, PriceResult, PriceSearcher } from '../types/index.js';
import { createPriceMonitor } from './priceMonitor.js';

function makeResult(overrides: Partial<PriceResult> = {}): PriceResult {
  return {
    title: 'Produto Teste',
    price: 500,
    currency: 'BRL',
    source: 'mercado-livre',
    store: 'Loja Oficial',
    url: 'https://example.com/item',
    ...overrides,
  };
}

describe('createPriceMonitor', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'price-monitor-test-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('triggers target-reached when price <= targetPrice and skips when above targetPrice', async () => {
    const store = createJsonAlertStore(tempDir);
    const alert = await store.create({ query: 'SSD 1TB', targetPrice: 450 });

    let currentPrice = 500;
    const searcher: PriceSearcher = {
      search: vi.fn(async () => [
        makeResult({ price: currentPrice + 50, store: 'Loja B' }),
        makeResult({ price: currentPrice, store: 'Loja A', title: 'SSD 1TB NVMe' }),
      ]),
    };
    const notifications: AlertTriggerEvent[] = [];
    const notifier = vi.fn(async (event: AlertTriggerEvent) => {
      notifications.push(event);
    });

    const currentTime = new Date('2026-01-01T10:00:00.000Z');
    const monitor = createPriceMonitor({
      store,
      searcher,
      notifier,
      cooldownMinutes: 60,
      now: () => currentTime,
    });

    // First check: price 500 > target 450
    const firstEvents = await monitor.checkAll();
    expect(firstEvents).toHaveLength(0);
    expect(notifier).not.toHaveBeenCalled();

    const afterFirst = await store.getById(alert.id);
    expect(afterFirst?.lastPrice).toBe(500);
    expect(afterFirst?.lowestPrice).toBe(500);
    expect(afterFirst?.lastResultStore).toBe('Loja A');

    // Second check: price drops to 420 <= target 450
    currentPrice = 420;
    const secondEvents = await monitor.checkAll();
    expect(secondEvents).toHaveLength(1);
    expect(secondEvents[0].reason).toBe('target-reached');
    expect(secondEvents[0].previousPrice).toBe(500);
    expect(secondEvents[0].bestResult.price).toBe(420);
    expect(notifier).toHaveBeenCalledTimes(1);

    const afterSecond = await store.getById(alert.id);
    expect(afterSecond?.lastNotifiedAt).toBe(currentTime.toISOString());
    expect(afterSecond?.lowestPrice).toBe(420);
  });

  it('respects cooldown to prevent spam unless price drops even lower than previousPrice', async () => {
    const store = createJsonAlertStore(tempDir);
    await store.create({ query: 'Echo Dot', targetPrice: 300 });

    let currentPrice = 280;
    const searcher: PriceSearcher = {
      search: vi.fn(async () => [makeResult({ price: currentPrice })]),
    };
    const notifier = vi.fn(async () => undefined);

    let nowMs = new Date('2026-01-01T10:00:00.000Z').getTime();
    const monitor = createPriceMonitor({
      store,
      searcher,
      notifier,
      cooldownMinutes: 60,
      now: () => new Date(nowMs),
    });

    // 10:00 - triggers first notification at 280
    expect(await monitor.checkAll()).toHaveLength(1);
    expect(notifier).toHaveBeenCalledTimes(1);

    // 10:15 - still 280, within 60m cooldown -> suppressed
    nowMs += 15 * 60 * 1000;
    expect(await monitor.checkAll()).toHaveLength(0);
    expect(notifier).toHaveBeenCalledTimes(1);

    // 10:30 - drops even further to 250 (< previousPrice 280) -> bypasses cooldown
    nowMs += 15 * 60 * 1000;
    currentPrice = 250;
    const dropEvents = await monitor.checkAll();
    expect(dropEvents).toHaveLength(1);
    expect(dropEvents[0].reason).toBe('target-reached');
    expect(notifier).toHaveBeenCalledTimes(2);

    // 11:45 - 75m after 10:30 notification, cooldown expired -> notifies again at 250
    nowMs += 75 * 60 * 1000;
    expect(await monitor.checkAll()).toHaveLength(1);
    expect(notifier).toHaveBeenCalledTimes(3);
  });

  it('triggers initial-price and then price-dropped when targetPrice is null', async () => {
    const store = createJsonAlertStore(tempDir);
    await store.create({ query: 'Kindle 11', targetPrice: null });

    let currentPrice = 550;
    const searcher: PriceSearcher = {
      search: vi.fn(async () => [makeResult({ price: currentPrice })]),
    };
    const events: AlertTriggerEvent[] = [];
    const notifier = vi.fn(async (event: AlertTriggerEvent) => {
      events.push(event);
    });

    let nowMs = new Date('2026-01-01T10:00:00.000Z').getTime();
    const monitor = createPriceMonitor({
      store,
      searcher,
      notifier,
      cooldownMinutes: 30,
      now: () => new Date(nowMs),
    });

    // First check: initial-price
    const first = await monitor.checkAll();
    expect(first).toHaveLength(1);
    expect(first[0].reason).toBe('initial-price');
    expect(first[0].previousPrice).toBeNull();

    // Same price after 10m -> no notification
    nowMs += 10 * 60 * 1000;
    expect(await monitor.checkAll()).toHaveLength(0);

    // Price drops within cooldown (20m after initial-price, < 30m cooldown) -> suppressed
    nowMs += 10 * 60 * 1000;
    currentPrice = 520;
    expect(await monitor.checkAll()).toHaveLength(0);

    // Price drops again after cooldown (55m after initial-price) -> price-dropped
    nowMs += 35 * 60 * 1000;
    currentPrice = 490;
    const dropped = await monitor.checkAll();
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('price-dropped');
    expect(dropped[0].previousPrice).toBe(520);
    expect(dropped[0].bestResult.price).toBe(490);
  });

  it('continues checking remaining alerts when searcher or notifier fails for one item', async () => {
    const store = createJsonAlertStore(tempDir);
    await store.create({ query: 'Item Com Erro', targetPrice: 100 });
    await store.create({ query: 'Item Sem Resultado', targetPrice: 100 });
    await store.create({ query: 'Item Ok', targetPrice: 200 });

    const searcher: PriceSearcher = {
      search: vi.fn(async (query: string) => {
        if (query === 'Item Com Erro') {
          throw new Error('Network timeout');
        }
        if (query === 'Item Sem Resultado') {
          return [];
        }
        return [makeResult({ title: 'Item Ok', price: 180 })];
      }),
    };

    const notifier = vi.fn(async () => undefined);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const monitor = createPriceMonitor({
      store,
      searcher,
      notifier,
      cooldownMinutes: 60,
      logger,
    });

    const events = await monitor.checkAll();
    expect(events).toHaveLength(1);
    expect(events[0].alert.query).toBe('Item Ok');
    expect(logger.error).toHaveBeenCalledTimes(1);

    const noResultAlert = await store.getById('2');
    expect(noResultAlert?.lastCheckedAt).not.toBeNull();
    expect(noResultAlert?.lastPrice).toBeNull();
  });

  it('prevents overlapping checkAll runs and supports start/stop/isRunning', async () => {
    const store = createJsonAlertStore(tempDir);
    await store.create({ query: 'Mouse Gamer', targetPrice: 150 });

    let resolveSearch!: (results: PriceResult[]) => void;
    let markSearchStarted!: () => void;
    const searchStarted = new Promise<void>((resolve) => {
      markSearchStarted = resolve;
    });
    const searcher: PriceSearcher = {
      search: vi.fn(() => {
        markSearchStarted();
        return new Promise<PriceResult[]>((resolve) => {
          resolveSearch = resolve;
        });
      }),
    };
    const notifier = vi.fn(async () => undefined);

    const monitor = createPriceMonitor({
      store,
      searcher,
      notifier,
      cooldownMinutes: 60,
    });

    // Overlap guard test
    const firstRun = monitor.checkAll();
    await searchStarted;
    const secondRun = await monitor.checkAll();
    expect(secondRun).toEqual([]);
    expect(searcher.search).toHaveBeenCalledTimes(1);

    resolveSearch([makeResult({ price: 140 })]);
    const firstResult = await firstRun;
    expect(firstResult).toHaveLength(1);

    // start / stop / isRunning test
    const activeAlert = await store.getById('1');
    vi.useFakeTimers();
    const inMemoryStore = {
      list: async () => (activeAlert ? [activeAlert] : []),
      listActive: async () => (activeAlert ? [activeAlert] : []),
      getById: async (id: string) => (activeAlert && activeAlert.id === id ? activeAlert : undefined),
      create: store.create,
      update: async (_id: string, patch: Record<string, unknown>) =>
        activeAlert ? Object.assign(activeAlert, patch) : undefined,
      remove: store.remove,
    };
    const fastSearcher: PriceSearcher = {
      search: vi.fn(async () => [makeResult({ price: 200 })]),
    };
    const scheduledMonitor = createPriceMonitor({
      store: inMemoryStore,
      searcher: fastSearcher,
      notifier,
      cooldownMinutes: 60,
    });

    expect(scheduledMonitor.isRunning()).toBe(false);
    scheduledMonitor.start(5);
    expect(scheduledMonitor.isRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(fastSearcher.search).toHaveBeenCalledTimes(1);

    scheduledMonitor.stop();
    expect(scheduledMonitor.isRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fastSearcher.search).toHaveBeenCalledTimes(1);
  });
});
