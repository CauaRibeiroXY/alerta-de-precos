import * as cheerio from 'cheerio';
import type { PriceResult } from '../types/index.js';
import { parseBrlPrice } from './buscape.js';

const AMAZON_BASE_URL = 'https://www.amazon.com.br';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function resolveAmazonUrl(href: string | undefined, asin: string | undefined): string {
  const cleanAsin = asin?.trim();
  if (href && href.includes('/sspa/click') && cleanAsin) {
    return `${AMAZON_BASE_URL}/dp/${cleanAsin}`;
  }
  if (href) {
    const trimmed = href.trim();
    const dpMatch = trimmed.match(/\/dp\/([A-Z0-9]{10})/i);
    if (dpMatch && (trimmed.includes('?') || trimmed.includes('/ref='))) {
      return `${AMAZON_BASE_URL}/dp/${dpMatch[1]}`;
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    if (trimmed.startsWith('/')) {
      return `${AMAZON_BASE_URL}${trimmed}`;
    }
  }
  if (cleanAsin) {
    return `${AMAZON_BASE_URL}/dp/${cleanAsin}`;
  }
  return '';
}

function isAmazonBlocked(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('validatecaptcha') ||
    lower.includes('digite os caracteres que você vê nesta imagem') ||
    lower.includes('enter the characters you see below')
  );
}

export function parseAmazonHtml(html: string): PriceResult[] {
  if (!html || isAmazonBlocked(html)) {
    return [];
  }

  const $ = cheerio.load(html);
  const results: PriceResult[] = [];

  $('[data-component-type="s-search-result"]').each((_, element) => {
    const card = $(element);
    const asin = card.attr('data-asin');
    const title =
      card.find('h2 a span').first().text().trim() ||
      card.find('h2 span').first().text().trim() ||
      card.find('h2').first().text().trim();

    if (!title) return;

    const priceText = card.find('.a-price .a-offscreen').first().text().trim();
    const price = parseBrlPrice(priceText);
    if (price === null || price <= 0) return;

    const rawHref = card.find('h2 a, a.a-link-normal').first().attr('href');
    const url = resolveAmazonUrl(rawHref, asin);
    if (!url) return;

    const imageUrl = card.find('img.s-image').first().attr('src')?.trim();

    results.push({
      title,
      price,
      currency: 'BRL',
      source: 'amazon',
      store: 'Amazon Brasil',
      url,
      ...(imageUrl ? { imageUrl } : {}),
    });
  });

  return results;
}

export async function searchAmazon(
  query: string,
  timeoutMs = 10_000
): Promise<PriceResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const url = `${AMAZON_BASE_URL}/s?k=${encodeURIComponent(trimmed)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    return parseAmazonHtml(html);
  } catch {
    return [];
  }
}
