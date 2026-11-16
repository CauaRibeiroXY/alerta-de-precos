import type {
  AlertTriggerEvent,
  AlertStore,
  NotifierFn,
  PriceResult,
  PriceSearcher,
} from '../types/index.js';

export interface PriceMonitorLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface PriceMonitorDeps {
  store: AlertStore;
  searcher: PriceSearcher;
  notifier: NotifierFn;
  cooldownMinutes: number;
  now?: () => Date;
  logger?: PriceMonitorLogger;
}

export interface PriceMonitor {
  checkAll(): Promise<AlertTriggerEvent[]>;
  start(intervalMinutes: number): void;
  stop(): void;
  isRunning(): boolean;
}

const noopLogger: PriceMonitorLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function pickBestResult(results: PriceResult[]): PriceResult {
  return results.reduce(
    (lowest, current) => (current.price < lowest.price ? current : lowest),
    results[0],
  );
}

export function createPriceMonitor(deps: PriceMonitorDeps): PriceMonitor {
  const {
    store,
    searcher,
    notifier,
    cooldownMinutes,
    now = () => new Date(),
    logger = noopLogger,
  } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;
  let checking = false;

  function isInCooldown(lastNotifiedAt: string | null, currentNow: Date): boolean {
    if (!lastNotifiedAt || cooldownMinutes <= 0) {
      return false;
    }
    const lastNotifiedMs = new Date(lastNotifiedAt).getTime();
    if (Number.isNaN(lastNotifiedMs)) {
      return false;
    }
    const elapsedMs = currentNow.getTime() - lastNotifiedMs;
    return elapsedMs < cooldownMinutes * 60 * 1000;
  }

  async function checkAll(): Promise<AlertTriggerEvent[]> {
    if (checking) {
      logger.warn('Price check already in progress, skipping overlapping run.');
      return [];
    }

    checking = true;
    const triggeredEvents: AlertTriggerEvent[] = [];

    try {
      const activeAlerts = await store.listActive();

      for (const alert of activeAlerts) {
        try {
          const checkTime = now();
          const checkIso = checkTime.toISOString();
          const results = await searcher.search(alert.query, { limit: 3 });

          if (results.length === 0) {
            await store.update(alert.id, { lastCheckedAt: checkIso });
            continue;
          }

          const bestResult = pickBestResult(results);
          const previousPrice = alert.lastPrice;
          const lowestPrice = Math.min(alert.lowestPrice ?? bestResult.price, bestResult.price);

          const updatedAlert =
            (await store.update(alert.id, {
              lastCheckedAt: checkIso,
              lastPrice: bestResult.price,
              lowestPrice,
              lastResultUrl: bestResult.url,
              lastResultTitle: bestResult.title,
              lastResultStore: bestResult.store,
            })) ?? {
              ...alert,
              lastCheckedAt: checkIso,
              lastPrice: bestResult.price,
              lowestPrice,
              lastResultUrl: bestResult.url,
              lastResultTitle: bestResult.title,
              lastResultStore: bestResult.store,
            };

          const inCooldown = isInCooldown(alert.lastNotifiedAt, checkTime);
          let reason: AlertTriggerEvent['reason'] | null = null;

          if (alert.targetPrice !== null) {
            if (bestResult.price <= alert.targetPrice) {
              const droppedFurther = previousPrice !== null && bestResult.price < previousPrice;
              if (!inCooldown || droppedFurther) {
                reason = 'target-reached';
              }
            }
          } else if (previousPrice === null) {
            reason = 'initial-price';
          } else if (bestResult.price < previousPrice && !inCooldown) {
            reason = 'price-dropped';
          }

          if (reason !== null) {
            const event: AlertTriggerEvent = {
              alert: updatedAlert,
              bestResult,
              previousPrice,
              reason,
            };

            await notifier(event);

            const notifiedAlert = await store.update(alert.id, {
              lastNotifiedAt: checkIso,
            });
            if (notifiedAlert) {
              event.alert = notifiedAlert;
            }

            triggeredEvents.push(event);
          }
        } catch (error) {
          logger.error(`Failed to check alert #${alert.id} ("${alert.query}"):`, error);
        }
      }
    } finally {
      checking = false;
    }

    return triggeredEvents;
  }

  function start(intervalMinutes: number): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    timer = setInterval(() => {
      void checkAll();
    }, intervalMs);

    logger.info(`Price monitor started with interval of ${intervalMinutes} minute(s).`);
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
      logger.info('Price monitor stopped.');
    }
  }

  function isRunning(): boolean {
    return timer !== null;
  }

  return {
    checkAll,
    start,
    stop,
    isRunning,
  };
}
