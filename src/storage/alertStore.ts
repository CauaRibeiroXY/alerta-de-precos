import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AlertCreateInput, AlertStore, PriceAlert } from '../types/index.js';

export function createJsonAlertStore(dataDir: string): AlertStore {
  const filePath = path.join(dataDir, 'alerts.json');
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  }

  async function ensureDir(): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });
  }

  async function readAlertsUnsafe(): Promise<PriceAlert[]> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as PriceAlert[];
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return [];
      }
      // Corrupted JSON or unreadable file: recover safely with empty list
      return [];
    }
  }

  async function writeAlertsUnsafe(alerts: PriceAlert[]): Promise<void> {
    await ensureDir();
    const tmpName = `.alerts.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const tmpPath = path.join(dataDir, tmpName);
    const content = JSON.stringify(alerts, null, 2);

    try {
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, filePath);
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }

  function nextNumericId(alerts: PriceAlert[]): string {
    let maxId = 0;
    for (const alert of alerts) {
      if (/^\d+$/.test(alert.id)) {
        const numeric = Number.parseInt(alert.id, 10);
        if (numeric > maxId) {
          maxId = numeric;
        }
      }
    }
    return String(maxId + 1);
  }

  return {
    list(): Promise<PriceAlert[]> {
      return enqueue(async () => {
        const alerts = await readAlertsUnsafe();
        return alerts.map((alert) => ({ ...alert }));
      });
    },

    listActive(): Promise<PriceAlert[]> {
      return enqueue(async () => {
        const alerts = await readAlertsUnsafe();
        return alerts.filter((alert) => alert.active).map((alert) => ({ ...alert }));
      });
    },

    getById(id: string): Promise<PriceAlert | undefined> {
      return enqueue(async () => {
        const alerts = await readAlertsUnsafe();
        const found = alerts.find((alert) => alert.id === id);
        return found ? { ...found } : undefined;
      });
    },

    create(input: AlertCreateInput): Promise<PriceAlert> {
      return enqueue(async () => {
        const alerts = await readAlertsUnsafe();
        const created: PriceAlert = {
          id: nextNumericId(alerts),
          query: input.query.trim(),
          targetPrice: input.targetPrice ?? null,
          active: true,
          createdAt: new Date().toISOString(),
          lastCheckedAt: null,
          lastPrice: null,
          lowestPrice: null,
          lastResultUrl: null,
          lastResultTitle: null,
          lastResultStore: null,
          lastNotifiedAt: null,
        };
        alerts.push(created);
        await writeAlertsUnsafe(alerts);
        return { ...created };
      });
    },

    update(id: string, patch: Partial<PriceAlert>): Promise<PriceAlert | undefined> {
      return enqueue(async () => {
        const alerts = await readAlertsUnsafe();
        const index = alerts.findIndex((alert) => alert.id === id);
        if (index === -1) {
          return undefined;
        }
        const updated: PriceAlert = {
          ...alerts[index],
          ...patch,
          id: alerts[index].id,
        };
        alerts[index] = updated;
        await writeAlertsUnsafe(alerts);
        return { ...updated };
      });
    },

    remove(id: string): Promise<boolean> {
      return enqueue(async () => {
        const alerts = await readAlertsUnsafe();
        const index = alerts.findIndex((alert) => alert.id === id);
        if (index === -1) {
          return false;
        }
        alerts.splice(index, 1);
        await writeAlertsUnsafe(alerts);
        return true;
      });
    },
  };
}
