import * as cheerio from 'cheerio';
import type { PriceResult } from '../types/index.js';
import { parseBrlPrice } from './buscape.js';

const GOOGLE_BASE_URL = 'https://www.google.com';
const DEFAULT_TIMEOUT_MS = 10_000;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const BLOCK_MARKERS = [
  'g-recaptcha',
  '/sorry/index',
  'unusual traffic from your computer network',
  'tráfego incomum',
  'detected unusual traffic',
  'please enable js',
  'enablejs',
];

function isBlockedHtml(html: string): boolean {
  const lower = html.toLowerCase();
  return BLOCK_MARKERS.some((marker) => lower.includes(marker));
}

function resolveGoogleUrl(rawHref: string | undefined): string {
  if (!rawHref) return '';
  const href = rawHref.trim();
  if (!href) return '';

  if (href.startsWith('/url?') || href.startsWith('https://www.google.com/url?')) {
    try {
      const fullUrl = href.startsWith('/') ? `${GOOGLE_BASE_URL}${href}` : href;
      const parsed = new URL(fullUrl);
      const target = parsed.searchParams.get('q') ?? parsed.searchParams.get('url');
      if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
        return target;
      }
    } catch {
      // Fallback to normal resolution below
    }
  }

  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${GOOGLE_BASE_URL}${href}`;
  return href;
}

function resolveImageUrl(rawSrc: string | undefined): string {
  if (!rawSrc) return '';
  const src = rawSrc.trim();
  if (!src || src.startsWith('data:')) return '';
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${GOOGLE_BASE_URL}${src}`;
  return src;
}

export function parseGoogleShoppingHtml(html: string): PriceResult[] {
  if (!html || !html.trim() || isBlockedHtml(html)) {
    return [];
  }

  const $ = cheerio.load(html);
  const results: PriceResult[] = [];

  const cardSelectors = [
    '.sh-dgr__content',
    '.sh-dlr__list-result',
    '.sh-pr__product-result',
    '.KZmu8e',
    '.i0X6df',
    '.xcR77',
    '[data-docid]',
  ].join(', ');

  $(cardSelectors).each((_, el) => {
    const card = $(el);

    const title = (
      card.find('h3, h4, .tAxDx, .Xjkr3b, .rgHvZc, [role="heading"]').first().text() ||
      card.find('a[aria-label]').first().attr('aria-label') ||
      ''
    ).trim();

    const priceText = (
      card.find('.a8Pemb, .HRLxBb, .kHxwFf, .T14wmb, [aria-label*="R$"]').first().text() ||
      card
        .find('span, b, div')
        .filter((__, node) => $(node).text().includes('R$'))
        .first()
        .text() ||
      ''
    ).trim();

    const price = parseBrlPrice(priceText);

    const rawHref =
      card.find('a.shntl[href], a.Lq5OHe[href], a.translate-content[href], a[href]').first().attr('href') ||
      '';
    const url = resolveGoogleUrl(rawHref);

    if (!title || price === null || !url) return;

    const store =
      (
        card.find('.aULzUe, .IuHnof, .E5ocAb, .dD8iuc').first().text() ||
        ''
      ).trim() || 'Google Shopping';

    const rawImg =
      card.find('img').first().attr('src') ||
      card.find('img').first().attr('data-src') ||
      '';
    const imageUrl = resolveImageUrl(rawImg);

    results.push({
      title,
      price,
      currency: 'BRL',
      source: 'google-shopping',
      store,
      url,
      ...(imageUrl ? { imageUrl } : {}),
    });
  });

  return results;
}

export async function searchGoogleShopping(
  query: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<PriceResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${GOOGLE_BASE_URL}/search?tbm=shop&hl=pt-BR&gl=br&q=${encodeURIComponent(trimmed)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    if (response.url.includes('/sorry/') || isBlockedHtml(html)) {
      return [];
    }

    return parseGoogleShoppingHtml(html);
  } catch {
    return [];
  }
}
