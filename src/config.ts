import path from 'node:path';
import type { MonitorConfig } from './types/index.js';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MonitorConfig {
  const rootDir = process.cwd();
  return {
    checkIntervalMinutes: parsePositiveInt(env.CHECK_INTERVAL_MINUTES, 30),
    alertCooldownMinutes: parsePositiveInt(env.ALERT_COOLDOWN_MINUTES, 240),
    maxSearchResults: parsePositiveInt(env.MAX_SEARCH_RESULTS, 5),
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(rootDir, 'data'),
    authDir: env.AUTH_DIR ? path.resolve(env.AUTH_DIR) : path.join(rootDir, 'auth_session'),
    logLevel: env.LOG_LEVEL || 'warn',
  };
}
