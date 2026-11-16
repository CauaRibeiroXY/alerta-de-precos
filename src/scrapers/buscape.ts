import * as cheerio from 'cheerio';
import type { PriceResult } from '../types/index.js';

const BUSCAPE_BASE_URL = 'https://www.buscape.com.br';
const DEFAULT_TIMEOUT_MS = 10_000;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

export function parseBrlPrice(text: string): number | null {
  if (!text) return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  // Reject explicitly negative values like "R$ -10,00" or "-10,00"
  if (/(?:^|\s|R\$\s*)-\s*\d/.test(trimmed)) {
    return null;
  }

  const match = trimmed.match(
    /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d{1,3}(?:\.\d{3})+|\d+(?:\.\d{1,2})?)/
  );
  if (!match) return null;

  const rawNumber = match[1];
  let normalized: string;

  if (rawNumber.includes(',')) {
    normalized = rawNumber.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(rawNumber)) {
    normalized = rawNumber.replace(/\./g, '');
  } else {
    normalized = rawNumber;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function resolveBuscapeUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '';
  const url = rawUrl.trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${BUSCAPE_BASE_URL}${url}`;
  return url;
}

interface BuscapeNextHit {
  name?: unknown;
  title?: unknown;
  price?: unknown;
  url?: unknown;
  image?: unknown;
  bestOffer?: {
    merchantName?: unknown;
  } | null;
  merchants?: Array<{
    name?: unknown;
  }> | null;
}

function parsePriceValue(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
  }
  if (typeof raw === 'string') {
    return parseBrlPrice(raw);
  }
  return null;
}

function extractFromNextData($: cheerio.CheerioAPI): PriceResult[] {
  const nextDataRaw = $('#__NEXT_DATA__').html() ?? $('#__NEXT_DATA__').text();
  if (!nextDataRaw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(nextDataRaw);
  } catch {
    return [];
  }

  const root = parsed as {
    props?: {
      initialReduxState?: {
        hits?: {
          hits?: unknown;
        };
      };
      pageProps?: {
        initialReduxState?: {
          hits?: {
            hits?: unknown;
          };
        };
      };
    };
  };

  const hits =
    root?.props?.initialReduxState?.hits?.hits ??
    root?.props?.pageProps?.initialReduxState?.hits?.hits;

  if (!Array.isArray(hits) || hits.length === 0) {
    return [];
  }

  const results: PriceResult[] = [];

  for (const item of hits as BuscapeNextHit[]) {
    if (!item || typeof item !== 'object') continue;

    const title = String(item.name ?? item.title ?? '').trim();
    const price = parsePriceValue(item.price);
    const url = resolveBuscapeUrl(item.url);

    if (!title || price === null || !url) continue;

    const merchantCandidate =
      item.bestOffer?.merchantName ?? item.merchants?.[0]?.name ?? 'Buscapé';
    const store = String(merchantCandidate).trim() || 'Buscapé';
    const imageUrl = resolveBuscapeUrl(item.image);

    results.push({
      title,
      price,
      currency: 'BRL',
      source: 'buscape',
      store,
      url,
      ...(imageUrl ? { imageUrl } : {}),
    });
  }

  return results;
}

function extractFromCards($: cheerio.CheerioAPI): PriceResult[] {
  const results: PriceResult[] = [];

  $('[data-testid="product-card"]').each((_, el) => {
    const card = $(el);

    const title = (
      card.find('[data-testid="product-card::name"]').first().text() ||
      card.find('h2, h3').first().text() ||
      card.find('a[title]').first().attr('title') ||
      ''
    ).trim();

    const priceText = (
      card.find('[data-testid="product-card::price"]').first().text() ||
      card.find('[data-testid*="price"]').first().text() ||
      card.find('[class*="Price"]').first().text() ||
      card.text()
    ).trim();

    const price = parseBrlPrice(priceText);

    const rawHref =
      card.find('a[data-testid="product-card::card"]').first().attr('href') ||
      card.find('a[href]').first().attr('href') ||
      '';
    const url = resolveBuscapeUrl(rawHref);

    if (!title || price === null || !url) return;

    const store =
      (
        card.find('[data-testid="product-card::merchant"]').first().text() ||
        card.find('[data-testid*="merchant"]').first().text() ||
        card.find('[class*="Merchant"]').first().text() ||
        ''
      ).trim() || 'Buscapé';

    const rawImg =
      card.find('img').first().attr('src') ||
      card.find('img').first().attr('data-src') ||
      '';
    const imageUrl = resolveBuscapeUrl(rawImg);

    results.push({
      title,
      price,
      currency: 'BRL',
      source: 'buscape',
      store,
      url,
      ...(imageUrl ? { imageUrl } : {}),
    });
  });

  return results;
}

export function parseBuscapeHtml(html: string): PriceResult[] {
  if (!html || !html.trim()) return [];

  const $ = cheerio.load(html);
  const nextDataResults = extractFromNextData($);
  if (nextDataResults.length > 0) {
    return nextDataResults;
  }

  return extractFromCards($);
}

export async function searchBuscape(
  query: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<PriceResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${BUSCAPE_BASE_URL}/search?q=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Buscapé HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseBuscapeHtml(html);
}
