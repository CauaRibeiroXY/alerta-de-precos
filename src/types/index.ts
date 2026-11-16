export type PriceSource = 'mercado-livre' | 'google-shopping' | 'buscape' | 'amazon';

export interface PriceResult {
  title: string;
  price: number;
  currency: 'BRL';
  source: PriceSource;
  store: string;
  url: string;
  imageUrl?: string;
}

export interface PriceAlert {
  id: string;
  query: string;
  targetPrice: number | null;
  active: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
  lastPrice: number | null;
  lowestPrice: number | null;
  lastResultUrl: string | null;
  lastResultTitle: string | null;
  lastResultStore: string | null;
  lastNotifiedAt: string | null;
}

export interface AlertCreateInput {
  query: string;
  targetPrice?: number | null;
}

export interface AlertStore {
  list(): Promise<PriceAlert[]>;
  listActive(): Promise<PriceAlert[]>;
  getById(id: string): Promise<PriceAlert | undefined>;
  create(input: AlertCreateInput): Promise<PriceAlert>;
  update(id: string, patch: Partial<PriceAlert>): Promise<PriceAlert | undefined>;
  remove(id: string): Promise<boolean>;
}

export interface SearchOptions {
  limit?: number;
  sources?: PriceSource[];
  timeoutMs?: number;
}

export interface PriceSearcher {
  search(query: string, options?: SearchOptions): Promise<PriceResult[]>;
}

export interface AlertTriggerEvent {
  alert: PriceAlert;
  bestResult: PriceResult;
  previousPrice: number | null;
  reason: 'target-reached' | 'price-dropped' | 'initial-price';
}

export type NotifierFn = (event: AlertTriggerEvent) => Promise<void>;

export type BotCommand =
  | { type: 'help' }
  | { type: 'search'; query: string; maxPrice?: number }
  | { type: 'alert'; query: string; targetPrice: number | null }
  | { type: 'list' }
  | { type: 'remove'; id: string }
  | { type: 'pause'; id: string }
  | { type: 'resume'; id: string }
  | { type: 'check-now' }
  | { type: 'unknown'; raw: string };

export interface MonitorConfig {
  checkIntervalMinutes: number;
  alertCooldownMinutes: number;
  maxSearchResults: number;
  dataDir: string;
  authDir: string;
  logLevel: string;
}
