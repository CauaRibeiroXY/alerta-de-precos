import type {
  PriceResult,
  PriceSearcher,
  PriceSource,
  SearchOptions,
} from '../types/index.js';
import { parseAmazonHtml, searchAmazon } from './amazon.js';
import { parseBrlPrice, parseBuscapeHtml, searchBuscape } from './buscape.js';
import {
  parseGoogleShoppingHtml,
  searchGoogleShopping,
} from './googleShopping.js';

export {
  parseAmazonHtml,
  searchAmazon,
  parseBrlPrice,
  parseBuscapeHtml,
  searchBuscape,
  parseGoogleShoppingHtml,
  searchGoogleShopping,
};

export type SourceFetcher = (
  query: string,
  timeoutMs: number
) => Promise<PriceResult[]>;

export type ScraperSourceMap = Partial<Record<PriceSource, SourceFetcher>>;

const DEFAULT_LIMIT = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

const DEFAULT_SOURCES: ScraperSourceMap = {
  buscape: searchBuscape,
  amazon: searchAmazon,
  'google-shopping': searchGoogleShopping,
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidResult(item: PriceResult): boolean {
  return (
    Boolean(item.title?.trim()) &&
    Boolean(item.url?.trim()) &&
    typeof item.price === 'number' &&
    Number.isFinite(item.price) &&
    item.price > 0
  );
}

const ACCESSORY_PATTERNS: RegExp[] = [
  /\bcapas?\b/i,
  /\bcapinhas?\b/i,
  /\bpeliculas?\b/i,
  /\bprotetor(?:es|a|as)?\b/i,
  /\bvidros?\s+temperados?\b/i,
  /\bhidrogel\b/i,
  /\bcases?\b/i,
  /\bestojos?\b/i,
  /\bsuportes?\b/i,
  /\bcabos?\b/i,
  /\badaptador(?:es)?\b/i,
  /\bcarregador(?:es)?\b/i,
  /\brisers?\b/i,
  /\bbolsas?\b/i,
  /\bcaixas?\s+de\s+armazenamento\b/i,
  /\bskins?\b/i,
  /\badesivos?\b/i,
  /\bpulseiras?\b/i,
  /\bbraceletes?\b/i,
];

const USED_CONDITION_PATTERNS: RegExp[] = [
  /\busados?\b/i,
  /\bseminovos?\b/i,
  /\brecondicionados?\b/i,
  /\bvitrine\b/i,
  /\brefurbished\b/i,
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitQueryAndExclusions(rawQuery: string): {
  searchQuery: string;
  excludedTerms: string[];
} {
  const tokens = rawQuery.trim().split(/\s+/);
  const positive: string[] = [];
  const excluded: string[] = [];

  for (const token of tokens) {
    if (token.startsWith('-') && token.length > 1) {
      const normalized = normalizeText(token.slice(1));
      if (normalized) {
        excluded.push(normalized);
      }
    } else {
      positive.push(token);
    }
  }

  return {
    searchQuery: positive.join(' ').trim(),
    excludedTerms: excluded,
  };
}

function hasAccessoryKeyword(normalizedTitle: string, normalizedQuery: string): boolean {
  return ACCESSORY_PATTERNS.some(
    (regex) => regex.test(normalizedTitle) && !regex.test(normalizedQuery)
  );
}

function hasUsedKeyword(normalizedTitle: string, normalizedQuery: string): boolean {
  return USED_CONDITION_PATTERNS.some(
    (regex) => regex.test(normalizedTitle) && !regex.test(normalizedQuery)
  );
}

function hasExcludedTerm(normalizedTitle: string, excludedTerms: string[]): boolean {
  return excludedTerms.some((term) => {
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i');
    return regex.test(normalizedTitle);
  });
}

function matchesAllQueryTokens(normalizedTitle: string, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return true;
  const compactTitle = normalizedTitle.replace(/\s+/g, '');
  const compactQuery = queryTokens.join('');
  if (compactTitle.includes(compactQuery)) {
    return true;
  }
  return queryTokens.every((token) => normalizedTitle.includes(token));
}

function filterRelevantResults(
  items: PriceResult[],
  searchQuery: string,
  excludedTerms: string[]
): PriceResult[] {
  const normalizedQuery = normalizeText(searchQuery);
  const queryTokens = normalizedQuery
    .split(/\s+/)
    .filter((token) => token.length >= 2);

  // Explicit -exclusions are always enforced strictly
  const withoutExcluded =
    excludedTerms.length > 0
      ? items.filter((item) => !hasExcludedTerm(normalizeText(item.title), excludedTerms))
      : items;

  const withoutUnwantedAccessories = withoutExcluded.filter(
    (item) => !hasAccessoryKeyword(normalizeText(item.title), normalizedQuery)
  );
  const accessoryPool =
    withoutUnwantedAccessories.length > 0 ? withoutUnwantedAccessories : withoutExcluded;

  const withoutUsed = accessoryPool.filter(
    (item) => !hasUsedKeyword(normalizeText(item.title), normalizedQuery)
  );
  const basePool = withoutUsed.length > 0 ? withoutUsed : accessoryPool;

  const exactMatches = basePool.filter((item) =>
    matchesAllQueryTokens(normalizeText(item.title), queryTokens)
  );

  return exactMatches.length > 0 ? exactMatches : basePool;
}

export function createPriceSearcher(
  customSources?: ScraperSourceMap
): PriceSearcher {
  const sourceMap: ScraperSourceMap = customSources ?? DEFAULT_SOURCES;

  return {
    async search(
      query: string,
      options: SearchOptions = {}
    ): Promise<PriceResult[]> {
      const { searchQuery, excludedTerms } = splitQueryAndExclusions(query);
      if (!searchQuery) {
        return [];
      }

      const limit =
        options.limit !== undefined &&
        Number.isFinite(options.limit) &&
        options.limit > 0
          ? Math.floor(options.limit)
          : DEFAULT_LIMIT;

      const timeoutMs =
        options.timeoutMs !== undefined &&
        Number.isFinite(options.timeoutMs) &&
        options.timeoutMs > 0
          ? options.timeoutMs
          : DEFAULT_TIMEOUT_MS;

      const requestedSources =
        options.sources && options.sources.length > 0
          ? options.sources
          : (Object.keys(sourceMap) as PriceSource[]);

      const activeFetchers = requestedSources
        .map((source) => sourceMap[source])
        .filter((fn): fn is SourceFetcher => typeof fn === 'function');

      if (activeFetchers.length === 0) {
        return [];
      }

      const settled = await Promise.allSettled(
        activeFetchers.map((fetcher) => fetcher(searchQuery, timeoutMs))
      );

      const collected: PriceResult[] = [];
      for (const result of settled) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          for (const item of result.value) {
            if (isValidResult(item)) {
              collected.push({
                ...item,
                title: item.title.trim(),
                store: item.store?.trim() || 'Loja',
                url: item.url.trim(),
              });
            }
          }
        }
      }

      const relevant = filterRelevantResults(collected, searchQuery, excludedTerms);
      relevant.sort((a, b) => a.price - b.price);

      const seen = new Set<string>();
      const deduplicated: PriceResult[] = [];

      for (const item of relevant) {
        const key = `${normalizeText(item.title)}::${normalizeText(item.store)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduplicated.push(item);

        if (deduplicated.length >= limit) {
          break;
        }
      }

      return deduplicated;
    },
  };
}

const defaultSearcher = createPriceSearcher();

export async function searchPrices(
  query: string,
  options?: SearchOptions
): Promise<PriceResult[]> {
  return defaultSearcher.search(query, options);
}
