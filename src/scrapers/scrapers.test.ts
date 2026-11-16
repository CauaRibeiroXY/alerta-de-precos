import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PriceResult } from '../types/index.js';
import {
  createPriceSearcher,
  parseAmazonHtml,
  parseBrlPrice,
  parseBuscapeHtml,
  parseGoogleShoppingHtml,
  searchPrices,
} from './index.js';

describe('parseBrlPrice', () => {
  it('parses standard Brazilian currency strings', () => {
    expect(parseBrlPrice('R$ 1.234,56')).toBe(1234.56);
    expect(parseBrlPrice('R$1.234,56')).toBe(1234.56);
    expect(parseBrlPrice('99,90')).toBe(99.9);
    expect(parseBrlPrice('a partir de R$ 2.499,00 em 10x')).toBe(2499);
    expect(parseBrlPrice('R$ 1.500')).toBe(1500);
  });

  it('returns null for zero, negative, empty or non-numeric strings', () => {
    expect(parseBrlPrice('')).toBeNull();
    expect(parseBrlPrice('   ')).toBeNull();
    expect(parseBrlPrice('R$ 0,00')).toBeNull();
    expect(parseBrlPrice('R$ -15,00')).toBeNull();
    expect(parseBrlPrice('Indisponível')).toBeNull();
  });
});

describe('parseBuscapeHtml', () => {
  it('extracts hits from #__NEXT_DATA__ JSON and prefixes relative URLs', () => {
    const nextData = {
      props: {
        initialReduxState: {
          hits: {
            hits: [
              {
                name: 'Notebook Gamer Acer Nitro',
                price: 4299.9,
                bestOffer: { merchantName: 'Amazon' },
                url: '/notebook/acer-nitro',
                image: 'https://img.buscape.com.br/nitro.jpg',
              },
              {
                name: 'Mouse Logitech MX Master',
                price: 499,
                merchants: [{ name: 'KaBuM!' }],
                url: 'https://www.buscape.com.br/mouse/mx-master',
                image: '//img.buscape.com.br/mx.jpg',
              },
              {
                name: 'Produto Sem Preco Valido',
                price: 0,
                url: '/invalido',
              },
              {
                name: 'Teclado Mecanico',
                price: 250,
                url: '/teclado',
              },
            ],
          },
        },
      },
    };

    const html = `
      <html>
        <body>
          <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
        </body>
      </html>
    `;

    const results = parseBuscapeHtml(html);

    expect(results).toEqual([
      {
        title: 'Notebook Gamer Acer Nitro',
        price: 4299.9,
        currency: 'BRL',
        source: 'buscape',
        store: 'Amazon',
        url: 'https://www.buscape.com.br/notebook/acer-nitro',
        imageUrl: 'https://img.buscape.com.br/nitro.jpg',
      },
      {
        title: 'Mouse Logitech MX Master',
        price: 499,
        currency: 'BRL',
        source: 'buscape',
        store: 'KaBuM!',
        url: 'https://www.buscape.com.br/mouse/mx-master',
        imageUrl: 'https://img.buscape.com.br/mx.jpg',
      },
      {
        title: 'Teclado Mecanico',
        price: 250,
        currency: 'BRL',
        source: 'buscape',
        store: 'Buscapé',
        url: 'https://www.buscape.com.br/teclado',
      },
    ]);
  });

  it('falls back to [data-testid="product-card"] HTML parsing when __NEXT_DATA__ has no hits', () => {
    const html = `
      <html>
        <body>
          <script id="__NEXT_DATA__" type="application/json">{"props":{"initialReduxState":{"hits":{"hits":[]}}}}</script>
          <div data-testid="product-card">
            <a data-testid="product-card::card" href="/celular/iphone-15">
              <img src="https://img.buscape.com.br/iphone15.jpg" />
              <h2 data-testid="product-card::name">iPhone 15 128GB</h2>
              <p data-testid="product-card::price">R$ 4.399,00</p>
              <span data-testid="product-card::merchant">Fast Shop</span>
            </a>
          </div>
          <div data-testid="product-card">
            <a href="/celular/invalido">
              <h2>Sem Preco</h2>
              <span>Sob consulta</span>
            </a>
          </div>
        </body>
      </html>
    `;

    const results = parseBuscapeHtml(html);

    expect(results).toEqual([
      {
        title: 'iPhone 15 128GB',
        price: 4399,
        currency: 'BRL',
        source: 'buscape',
        store: 'Fast Shop',
        url: 'https://www.buscape.com.br/celular/iphone-15',
        imageUrl: 'https://img.buscape.com.br/iphone15.jpg',
      },
    ]);
  });
});

describe('parseGoogleShoppingHtml', () => {
  it('parses Google Shopping HTML cards and unwraps /url?q= links', () => {
    const html = `
      <html>
        <body>
          <div class="sh-dgr__content">
            <h3 class="tAxDx">Monitor LG UltraGear 24</h3>
            <span class="a8Pemb">R$ 899,90</span>
            <div class="aULzUe">Mercado Livre</div>
            <a class="shntl" href="/url?q=https://www.mercadolivre.com.br/monitor-lg&sa=U">Ver oferta</a>
            <img src="https://encrypted-tbn0.gstatic.com/shopping?q=1" />
          </div>
          <div class="sh-dlr__list-result">
            <h4>Cadeira Ergonomica</h4>
            <span class="HRLxBb">R$ 1.199,00</span>
            <a href="https://loja.exemplo.com.br/cadeira">Comprar</a>
          </div>
        </body>
      </html>
    `;

    const results = parseGoogleShoppingHtml(html);

    expect(results).toEqual([
      {
        title: 'Monitor LG UltraGear 24',
        price: 899.9,
        currency: 'BRL',
        source: 'google-shopping',
        store: 'Mercado Livre',
        url: 'https://www.mercadolivre.com.br/monitor-lg',
        imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=1',
      },
      {
        title: 'Cadeira Ergonomica',
        price: 1199,
        currency: 'BRL',
        source: 'google-shopping',
        store: 'Google Shopping',
        url: 'https://loja.exemplo.com.br/cadeira',
      },
    ]);
  });

  it('returns empty array when HTML contains captcha or block page', () => {
    const captchaHtml = `
      <html>
        <body>
          <form action="/sorry/index">
            <div class="g-recaptcha">Our systems have detected unusual traffic from your computer network.</div>
          </form>
        </body>
      </html>
    `;

    expect(parseGoogleShoppingHtml(captchaHtml)).toEqual([]);
  });
});

describe('createPriceSearcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty or whitespace-only query without calling sources', async () => {
    const buscapeSpy = vi.fn(async () => []);
    const googleSpy = vi.fn(async () => []);
    const searcher = createPriceSearcher({
      buscape: buscapeSpy,
      'google-shopping': googleSpy,
    });

    expect(await searcher.search('')).toEqual([]);
    expect(await searcher.search('   \t\n  ')).toEqual([]);
    expect(buscapeSpy).not.toHaveBeenCalled();
    expect(googleSpy).not.toHaveBeenCalled();
  });

  it('sorts by lowest price, deduplicates by normalized title+store, filters invalid prices and applies limit', async () => {
    const buscapeResults: PriceResult[] = [
      {
        title: 'Air Fryer Philco 4L',
        price: 349.9,
        currency: 'BRL',
        source: 'buscape',
        store: 'Amazon',
        url: 'https://www.buscape.com.br/air-fryer-1',
      },
      {
        title: 'Air Fryer Philco 4L',
        price: 0,
        currency: 'BRL',
        source: 'buscape',
        store: 'Loja Zero',
        url: 'https://www.buscape.com.br/invalido-zero',
      },
      {
        title: 'Air Fryer Mondial 4L',
        price: Number.NaN,
        currency: 'BRL',
        source: 'buscape',
        store: 'Loja NaN',
        url: 'https://www.buscape.com.br/invalido-nan',
      },
      {
        title: 'Air Fryer Britania',
        price: 279,
        currency: 'BRL',
        source: 'buscape',
        store: 'Magalu',
        url: 'https://www.buscape.com.br/air-fryer-britania',
      },
      {
        title: 'Air Fryer Oster',
        price: 399,
        currency: 'BRL',
        source: 'buscape',
        store: 'Casas Bahia',
        url: 'https://www.buscape.com.br/air-fryer-oster',
      },
      {
        title: 'Air Fryer Electrolux',
        price: 459,
        currency: 'BRL',
        source: 'buscape',
        store: 'Fast Shop',
        url: 'https://www.buscape.com.br/air-fryer-electrolux',
      },
      {
        title: 'Air Fryer Cadence',
        price: 510,
        currency: 'BRL',
        source: 'buscape',
        store: 'Shopee',
        url: 'https://www.buscape.com.br/air-fryer-cadence',
      },
    ];

    const googleResults: PriceResult[] = [
      {
        title: '  air   fryer philco 4l ',
        price: 319.9,
        currency: 'BRL',
        source: 'google-shopping',
        store: 'amazon ',
        url: 'https://amazon.com.br/air-fryer-philco',
      },
      {
        title: 'Air Fryer Arno',
        price: 299.5,
        currency: 'BRL',
        source: 'google-shopping',
        store: 'Carrefour',
        url: 'https://carrefour.com.br/air-fryer-arno',
      },
    ];

    const searcher = createPriceSearcher({
      buscape: async () => buscapeResults,
      'google-shopping': async () => googleResults,
    });

    const results = await searcher.search('air fryer');

    expect(results).toHaveLength(5);
    expect(results.map((r) => ({ title: r.title, store: r.store, price: r.price }))).toEqual([
      { title: 'Air Fryer Britania', store: 'Magalu', price: 279 },
      { title: 'Air Fryer Arno', store: 'Carrefour', price: 299.5 },
      { title: 'air   fryer philco 4l', store: 'amazon', price: 319.9 },
      { title: 'Air Fryer Oster', store: 'Casas Bahia', price: 399 },
      { title: 'Air Fryer Electrolux', store: 'Fast Shop', price: 459 },
    ]);

    const limited = await searcher.search('air fryer', { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0].price).toBe(279);
    expect(limited[1].price).toBe(299.5);
  });

  it('continues returning results when one source fails', async () => {
    const searcher = createPriceSearcher({
      buscape: async () => {
        throw new Error('Buscapé timeout');
      },
      'google-shopping': async () => [
        {
          title: 'SSD Kingston 1TB',
          price: 379.9,
          currency: 'BRL',
          source: 'google-shopping',
          store: 'KaBuM!',
          url: 'https://kabum.com.br/ssd-1tb',
        },
      ],
    });

    const results = await searcher.search('ssd 1tb');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'SSD Kingston 1TB',
      price: 379.9,
      source: 'google-shopping',
      store: 'KaBuM!',
    });
  });

  it('searchPrices handles live fetch failure in Google Shopping gracefully when Buscapé succeeds', async () => {
    const buscapeHtml = `
      <html><body>
        <div data-testid="product-card">
          <a href="/fone-bluetooth">
            <h2 data-testid="product-card::name">Fone Bluetooth JBL</h2>
            <p data-testid="product-card::price">R$ 199,90</p>
            <span data-testid="product-card::merchant">Amazon</span>
          </a>
        </div>
      </body></html>
    `;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('buscape.com.br')) {
          return new Response(buscapeHtml, { status: 200 });
        }
        return new Response('Too Many Requests', { status: 429 });
      })
    );

    const results = await searchPrices('fone bluetooth');
    expect(results).toEqual([
      {
        title: 'Fone Bluetooth JBL',
        price: 199.9,
        currency: 'BRL',
        source: 'buscape',
        store: 'Amazon',
        url: 'https://www.buscape.com.br/fone-bluetooth',
      },
    ]);
  });
});

describe('parseAmazonHtml', () => {
  it('extracts Amazon products, prefers clean /dp/ links for sponsored items, and skips invalid cards', () => {
    const html = `
      <html>
        <body>
          <div data-component-type="s-search-result" data-asin="B0CHX1W1XY">
            <h2><a href="/sspa/click?ie=UTF8&url=test"><span>Apple iPhone 15 (128 GB) — Preto</span></a></h2>
            <span class="a-price"><span class="a-offscreen">R$ 3.989,05</span></span>
            <img class="s-image" src="https://m.media-amazon.com/images/I/iphone15.jpg" />
          </div>
          <div data-component-type="s-search-result" data-asin="B09XYZ1234">
            <h2><a href="/Apple-iPhone-15/dp/B09XYZ1234"><span>Capa Silicone iPhone 15</span></a></h2>
            <span class="a-price"><span class="a-offscreen">R$ 79,90</span></span>
          </div>
          <div data-component-type="s-search-result" data-asin="B000000000">
            <h2><span>Produto Sem Preco</span></h2>
          </div>
        </body>
      </html>
    `;

    expect(parseAmazonHtml(html)).toEqual([
      {
        title: 'Apple iPhone 15 (128 GB) — Preto',
        price: 3989.05,
        currency: 'BRL',
        source: 'amazon',
        store: 'Amazon Brasil',
        url: 'https://www.amazon.com.br/dp/B0CHX1W1XY',
        imageUrl: 'https://m.media-amazon.com/images/I/iphone15.jpg',
      },
      {
        title: 'Capa Silicone iPhone 15',
        price: 79.9,
        currency: 'BRL',
        source: 'amazon',
        store: 'Amazon Brasil',
        url: 'https://www.amazon.com.br/Apple-iPhone-15/dp/B09XYZ1234',
      },
    ]);
  });

  it('returns empty array when Amazon presents a captcha page', () => {
    const captchaHtml = `<html><body><form action="/errors/validateCaptcha"></form></body></html>`;
    expect(parseAmazonHtml(captchaHtml)).toEqual([]);
  });

  it('filters out cheap accessories and unrelated items when query asks for the main product', async () => {
    const searcher = createPriceSearcher({
      amazon: async () => [
        {
          title: 'Capa rígida à prova de choque para RTX 4060',
          price: 147.87,
          currency: 'BRL',
          source: 'amazon',
          store: 'Amazon Brasil',
          url: 'https://www.amazon.com.br/dp/B0001',
        },
        {
          title: 'Suporte de placa gráfica para RTX 4060',
          price: 120.0,
          currency: 'BRL',
          source: 'amazon',
          store: 'Amazon Brasil',
          url: 'https://www.amazon.com.br/dp/B0002',
        },
        {
          title: 'Placa de Vídeo RX 550 4GB',
          price: 527.24,
          currency: 'BRL',
          source: 'amazon',
          store: 'Amazon Brasil',
          url: 'https://www.amazon.com.br/dp/B0003',
        },
        {
          title: 'Placa de Vídeo MSI GeForce RTX 4060 8GB Ventus 2X',
          price: 2199.0,
          currency: 'BRL',
          source: 'amazon',
          store: 'Amazon Brasil',
          url: 'https://www.amazon.com.br/dp/B0004',
        },
      ],
    });

    const results = await searcher.search('rtx 4060');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Placa de Vídeo MSI GeForce RTX 4060 8GB Ventus 2X');
    expect(results[0].price).toBe(2199.0);
  });

  it('filters out plural accessory terms such as Películas, Capas and Carregadores', async () => {
    const searcher = createPriceSearcher({
      buscape: async () => [
        {
          title: '3 Películas Hidrogel Para Samsung Galaxy S25 S25+ S25 Fe',
          price: 41.54,
          currency: 'BRL',
          source: 'buscape',
          store: 'Magazine Luiza',
          url: 'https://www.buscape.com.br/pelicula-s25',
        },
        {
          title: 'Capas Transparentes para Galaxy S25',
          price: 59.9,
          currency: 'BRL',
          source: 'buscape',
          store: 'Amazon',
          url: 'https://www.buscape.com.br/capas-s25',
        },
        {
          title: 'Carregadores Turbo 45W para Galaxy S25',
          price: 129.0,
          currency: 'BRL',
          source: 'buscape',
          store: 'Amazon',
          url: 'https://www.buscape.com.br/carregadores-s25',
        },
        {
          title: 'Celular Samsung Galaxy S25 5G 256GB 12 GB',
          price: 3656.49,
          currency: 'BRL',
          source: 'buscape',
          store: 'Magazine Luiza',
          url: 'https://www.buscape.com.br/s25',
        },
      ],
    });

    const results = await searcher.search('s25');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Celular Samsung Galaxy S25 5G 256GB 12 GB');
  });

  it('supports -term exclusion syntax without sending -term to sources', async () => {
    const receivedQueries: string[] = [];
    const searcher = createPriceSearcher({
      amazon: async (query) => {
        receivedQueries.push(query);
        return [
          {
            title: 'Celular Samsung Galaxy S25 FE 5G, 128GB, 8GB',
            price: 2699.09,
            currency: 'BRL',
            source: 'amazon',
            store: 'Amazon Brasil',
            url: 'https://www.amazon.com.br/dp/B0FTCYVMVC',
          },
          {
            title: 'Celular Samsung Galaxy S25 Plus 5G, 512GB, 12GB',
            price: 4999.0,
            currency: 'BRL',
            source: 'amazon',
            store: 'Amazon Brasil',
            url: 'https://www.amazon.com.br/dp/B0000PLUS',
          },
          {
            title: 'Celular Samsung Galaxy S25 5G, 256GB, 12GB RAM',
            price: 3656.49,
            currency: 'BRL',
            source: 'amazon',
            store: 'Amazon Brasil',
            url: 'https://www.amazon.com.br/dp/B0000BASE',
          },
        ];
      },
    });

    const results = await searcher.search('galaxy s25 -fe -plus');
    expect(receivedQueries).toEqual(['galaxy s25']);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Celular Samsung Galaxy S25 5G, 256GB, 12GB RAM');
  });

  it('filters out used/seminovo/recondicionado listings unless explicitly requested', async () => {
    const searcher = createPriceSearcher({
      amazon: async () => [
        {
          title: 'Celular Samsung Galaxy S25 5G 256GB (Seminovo)',
          price: 3100.0,
          currency: 'BRL',
          source: 'amazon',
          store: 'Amazon Brasil',
          url: 'https://www.amazon.com.br/dp/B000USED',
        },
        {
          title: 'Celular Samsung Galaxy S25 5G 256GB Usado',
          price: 2900.0,
          currency: 'BRL',
          source: 'amazon',
          store: 'Amazon Brasil',
          url: 'https://www.amazon.com.br/dp/B000USED2',
        },
        {
          title: 'Celular Samsung Galaxy S25 5G 256GB Novo Lacrado',
          price: 3656.49,
          currency: 'BRL',
          source: 'amazon',
          store: 'Amazon Brasil',
          url: 'https://www.amazon.com.br/dp/B000NEW',
        },
      ],
    });

    const newOnly = await searcher.search('galaxy s25');
    expect(newOnly).toHaveLength(1);
    expect(newOnly[0].title).toBe('Celular Samsung Galaxy S25 5G 256GB Novo Lacrado');

    const withUsed = await searcher.search('galaxy s25 seminovo');
    expect(withUsed).toHaveLength(1);
    expect(withUsed[0].title).toBe('Celular Samsung Galaxy S25 5G 256GB (Seminovo)');
  });

  it('shortens long Amazon tracking URLs containing /dp/ASIN and ref/query params', () => {
    const html = `
      <html><body>
        <div data-component-type="s-search-result" data-asin="B0FTCYVMVC">
          <h2><a href="/Celular-Samsung-Galaxy/dp/B0FTCYVMVC/ref=sr_1_6?dib=eyJ2&keywords=galaxy+S25"><span>Galaxy S25</span></a></h2>
          <span class="a-price"><span class="a-offscreen">R$ 3.599,00</span></span>
        </div>
      </body></html>
    `;
    const parsed = parseAmazonHtml(html);
    expect(parsed[0].url).toBe('https://www.amazon.com.br/dp/B0FTCYVMVC');
  });
});

