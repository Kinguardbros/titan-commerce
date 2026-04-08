// Quick local test for the scraper utils
// Run: node test-scraper.mjs

import { scrapeCollectionUrls, scrapeProduct, generateHooks, generateHeadlines } from './lib/scraper-utils.js';

const COLLECTION_URL = 'https://shop-elegancehouse.com/collections/all';

async function main() {
  console.log('--- Scraping collection page ---');
  console.log(`URL: ${COLLECTION_URL}\n`);

  let urls;
  try {
    urls = await scrapeCollectionUrls(COLLECTION_URL, 5);
    console.log(`Found ${urls.length} product URLs:`);
    urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  } catch (err) {
    console.error('Failed to scrape collection:', err.message);
    return;
  }

  console.log('\n--- Scraping individual products ---\n');

  for (const url of urls) {
    try {
      const product = await scrapeProduct(url);
      const hooks = generateHooks(product);
      const headlines = generateHeadlines(product);

      console.log(`Product: ${product.product_name || '(no name)'}`);
      console.log(`  Price: ${product.price || '(no price)'}`);
      console.log(`  Description: ${(product.description || '').slice(0, 80)}...`);
      console.log(`  Image alts: ${product.image_alts.length}`);
      console.log(`  Features: ${product.features.length}`);
      console.log(`  Hooks: ${hooks.join(' | ')}`);
      console.log(`  Headlines: ${headlines.join(' | ')}`);
      console.log('');
    } catch (err) {
      console.error(`Failed to scrape ${url}:`, err.message);
    }
  }

  console.log('--- Done ---');
}

main();
