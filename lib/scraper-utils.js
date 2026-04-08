import * as cheerio from 'cheerio';

function decodeEntities(text) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

/**
 * Scrape a single product page and extract structured data.
 */
export async function scrapeProduct(url) {
  const html = await fetch(url, {
    headers: { 'User-Agent': 'EleganceHouseBot/1.0' },
  }).then((r) => r.text());

  const $ = cheerio.load(html);

  const product_name =
    $('h1.product-title, h1.product__title, h1').first().text().trim() || '';

  const price =
    $('.product-price, .price, .product__price, [data-product-price]')
      .first()
      .text()
      .trim()
      .replace(/\s+/g, ' ') || '';

  const description = decodeEntities(
    $('.product-description, .product__description, .rte')
      .first()
      .text()
      .trim() || ''
  );

  const image_alts = $('img[alt]')
    .map((_, el) => $(el).attr('alt'))
    .get()
    .filter((alt) => alt && alt.length > 2);

  // Extract real product image URLs
  const image_urls = [];

  // 1. og:image — usually the hero product shot
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) image_urls.push(ogImage.replace(/^http:/, 'https:'));

  // 2. JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      if (json.image?.url) image_urls.push(json.image.url);
      if (typeof json.image === 'string') image_urls.push(json.image);
      if (Array.isArray(json.image)) json.image.forEach((img) => {
        image_urls.push(typeof img === 'string' ? img : img.url);
      });
    } catch (parseErr) {
      // JSON-LD parse error — skip silently (expected for non-product pages)
    }
  });

  // 3. Shopify CDN product images from img tags
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src.includes('cdn.shopify.com') && (src.includes('/products/') || src.includes('/files/')) && !src.includes('badge') && !src.includes('.svg')) {
      const fullUrl = src.startsWith('//') ? `https:${src}` : src;
      if (!image_urls.includes(fullUrl)) image_urls.push(fullUrl);
    }
  });

  const features = $(
    '.product-features li, .product-detail li, .product__features li'
  )
    .map((_, el) => $(el).text().trim())
    .get();

  const meta_description =
    $('meta[name="description"]').attr('content') || '';

  return {
    product_name,
    price,
    description,
    image_alts: image_alts.slice(0, 20),
    image_urls: image_urls.filter(Boolean).slice(0, 5),
    features,
    meta_description,
    url,
  };
}

/**
 * Scrape a collection page and return individual product URLs.
 */
export async function scrapeCollectionUrls(collectionUrl, limit = 5) {
  const html = await fetch(collectionUrl, {
    headers: { 'User-Agent': 'EleganceHouseBot/1.0' },
  }).then((r) => r.text());

  const $ = cheerio.load(html);
  const baseUrl = new URL(collectionUrl).origin;
  const urls = [];

  // Shopify-style product links
  $('a[href*="/products/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const full = href.startsWith('http') ? href : `${baseUrl}${href}`;
    // Deduplicate
    if (!urls.includes(full)) urls.push(full);
  });

  return urls.slice(0, limit);
}

/**
 * Generate copy hooks from scraped product data.
 * Pure heuristic extraction — no AI call needed for MVP.
 */
export function generateHooks(product, maxHooks = 5) {
  const hooks = [];
  const { product_name, price, description, features, meta_description } =
    product;

  // Price-based hooks
  if (price) {
    hooks.push(`Get the ${product_name} — starting at ${price}`);
    hooks.push(`${product_name}: style meets value at ${price}`);
  }

  // Feature-based hooks
  if (features.length > 0) {
    hooks.push(`${product_name} — ${features[0]}`);
  }

  // Description-based hooks
  if (description) {
    const firstSentence = description.split(/[.!?]/).filter(Boolean)[0];
    if (firstSentence && firstSentence.length > 10 && firstSentence.length < 100) {
      hooks.push(firstSentence.trim());
    }
  }

  // Meta description hook
  if (meta_description && meta_description.length > 10) {
    hooks.push(meta_description.slice(0, 100).trim());
  }

  // Generic brand hooks
  hooks.push(`Discover ${product_name} — Elegance, delivered.`);
  hooks.push(`${product_name}: Timeless style for the modern woman`);

  return hooks.slice(0, maxHooks).map(decodeEntities);
}

/**
 * Generate headlines from product data.
 */
export function generateHeadlines(product) {
  const { product_name, price } = product;
  const headlines = [
    `Shop ${product_name}`,
    `New: ${product_name}`,
    `${product_name} — Now Available`,
  ];
  if (price) {
    headlines.push(`${product_name} from ${price}`);
  }
  return headlines;
}
