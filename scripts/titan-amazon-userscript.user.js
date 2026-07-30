// ==UserScript==
// @name         Titan Commerce — Amazon Reviews Importer
// @namespace    https://titan-commerce.vercel.app/
// @version      1.0.0
// @description  Scrape Amazon product reviews on this page and import them into Titan Commerce as pending reviews.
// @author       Dan
// @match        https://www.amazon.com/*
// @match        https://smile.amazon.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      titan-commerce.vercel.app
// @updateURL    https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js
// @downloadURL  https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_TITAN_URL = 'https://titan-commerce.vercel.app';

  function getConfig() {
    return {
      token: GM_getValue('TITAN_API_TOKEN', ''),
      titanUrl: GM_getValue('TITAN_URL', DEFAULT_TITAN_URL),
    };
  }

  // "John Smith" -> "John S." ; single-token/emoji-only/empty -> "Anonymous".
  // Mirrors the Titan-side copy in lib/actions/reviews-amazon.js (D-07) — this
  // client-side copy runs first so raw full names never leave the browser.
  function anonymizeAuthor(fullName) {
    if (!fullName || typeof fullName !== 'string') return 'Anonymous';
    const trimmed = fullName.trim();
    if (!trimmed) return 'Anonymous';
    if (trimmed.length === 1 || !/[a-zA-Z]/.test(trimmed)) return 'Anonymous';
    const parts = trimmed.split(/\s+/);
    const first = parts[0];
    const lastInitial = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() : '';
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  function parseRating(text) {
    const first = String(text || '').trim().split(' ')[0].replace(',', '.');
    const n = parseFloat(first);
    return Number.isFinite(n) ? n : null;
  }

  function parseHelpfulCount(text) {
    const s = String(text || '').trim();
    if (!s) return 0;
    if (/^one person found this helpful/i.test(s)) return 1;
    const m = s.match(/(\d[\d,]*)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  }

  function upgradePhotoUrl(url) {
    return url.replace(/\._[A-Z]{2}\d+_?\./, '._SL1600_.');
  }

  // Reuses feature-03's data-hook selector knowledge (lib/actions/reviews-amazon.js's
  // sibling VPS scraper, /root/titan-scraper/parser.js) — same DOM shape, different
  // execution context (real browser DOM here, not Puppeteer).
  const SELECTORS = {
    reviewCard: 'div[data-hook="review"]',
    starRating: 'i[data-hook="review-star-rating"] span.a-icon-alt',
    // Amazon renamed review sub-hooks to camelCase (~2026): reviewTitle, reviewText,
    // reviewRichContentContainer. Keep hyphenated fallbacks for older markup and
    // per-region variance (some Amazon locales still ship the legacy names).
    author: 'span.a-profile-name',
    // Title: new = <h5 data-hook="reviewTitle">, old = <a data-hook="review-title"> <span>
    reviewTitle: '[data-hook="reviewTitle"], a[data-hook="review-title"] span:not([class*="a-color-secondary"])',
    // Body: new = <div data-hook="reviewText"><div data-hook="reviewRichContentContainer">TEXT</div>
    // Prefer the rich-content container (holds the actual review paragraph, not the "Brief content..." wrapper text)
    reviewBody: '[data-hook="reviewRichContentContainer"], span[data-hook="review-body"] span, [data-hook="reviewText"]',
    verifiedBadge: 'span[data-hook="avp-badge"], [data-hook="avp-badge"]',
    // Photos: new markup uses different classes; support all known variants
    photos: 'div[data-hook="review-image-tile-section"] img, [data-hook="review-image-tile-section"] img, img[data-hook="review-image-tile"], .review-image-tile-section img, img.review-image-tile, .cr-lightbox-image-thumbnail img',
    helpfulText: 'span[data-hook="helpful-vote-statement"], [data-hook="helpful-vote-statement"]',
    reviewDate: 'span[data-hook="review-date"], [data-hook="review-date"]',
    nextPageLink: 'ul.a-pagination li.a-last a',
  };

  // Extract review objects from any DOM-tree-like root — used against both
  // the live document (dp/ page reviews) and DOMParser-parsed HTML from
  // paginated /product-reviews/{asin} fetches.
  function extractReviewsFromRoot(root) {
    const cards = Array.from(root.querySelectorAll(SELECTORS.reviewCard));
    return cards.map((card) => {
      const starEl = card.querySelector(SELECTORS.starRating);
      const authorEl = card.querySelector(SELECTORS.author);
      const titleEl = card.querySelector(SELECTORS.reviewTitle);
      const bodyEl = card.querySelector(SELECTORS.reviewBody);
      const verifiedEl = card.querySelector(SELECTORS.verifiedBadge);
      const helpfulEl = card.querySelector(SELECTORS.helpfulText);
      const dateEl = card.querySelector(SELECTORS.reviewDate);
      const photoEls = Array.from(card.querySelectorAll(SELECTORS.photos));

      const rating = parseRating(starEl?.textContent?.trim());
      if (rating === null) return null;

      return {
        author: anonymizeAuthor(authorEl?.textContent?.trim()),
        rating,
        title: (titleEl?.textContent?.trim() || '').slice(0, 200),
        body: (bodyEl?.textContent?.trim() || '').slice(0, 2000),
        verified: !!verifiedEl,
        photo_urls: photoEls.map((img) => img.getAttribute('src')).filter(Boolean).slice(0, 1).map(upgradePhotoUrl),
        helpful_count: parseHelpfulCount(helpfulEl?.textContent?.trim()),
        review_date: dateEl?.textContent?.trim() || '',
      };
    }).filter(Boolean);
  }

  function extractReviewsFromDom() {
    return extractReviewsFromRoot(document);
  }

  function gmFetch(url, options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url,
        headers: options.headers || {},
        data: options.body,
        timeout: 55000,
        onload: (resp) => resolve(resp),
        onerror: (err) => reject(new Error('Network error: ' + (err?.error || 'request failed'))),
        ontimeout: () => reject(new Error('Request timed out')),
      });
    });
  }

  // Fetches up to maxReviews across paginated /product-reviews/{asin} pages by
  // navigating the actual browser tab (document.location) would lose script state,
  // so instead we fetch each page's HTML via GM_xmlhttpRequest and parse it with
  // DOMParser — keeps everything in one script execution, no page reloads.
  async function scrapeReviews(asin, maxReviews) {
    const collected = [];
    // Dedup key: author + first-100-chars of body (matches server's md5(body) unique index
    // pattern closely enough to avoid re-sending obvious duplicates between DOM and fetched pages).
    const seen = new Set();
    const dedupKey = (r) => `${r.author}|${(r.body || '').slice(0, 100)}`;
    const push = (r) => {
      const k = dedupKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      collected.push(r);
      return true;
    };

    // Prefer live DOM on product page (dp/ASIN) — Amazon serves visible reviews there
    // to the logged-in session, while /product-reviews/{asin} increasingly returns
    // signed-out shells with zero cards. Then continue with paginated fetches for more.
    for (const r of extractReviewsFromDom()) {
      if (collected.length >= maxReviews) break;
      push(r);
    }
    if (collected.length >= maxReviews) return collected.slice(0, maxReviews);

    // Paginated fetch — up to 10 pages ≈ 100 raw reviews, then dedup + cap.
    // If Amazon returns signed-out shells (0 cards on all pages), we simply return
    // whatever DOM gave us.
    let pageNumber = 1;
    while (collected.length < maxReviews && pageNumber <= 10) {
      const url = `https://${window.location.hostname}/product-reviews/${asin}/?sortBy=recent&pageNumber=${pageNumber}`;
      const resp = await gmFetch(url, { method: 'GET' });
      if (resp.status >= 400) break;

      const doc = new DOMParser().parseFromString(resp.responseText, 'text/html');
      const pageReviews = extractReviewsFromRoot(doc);
      if (pageReviews.length === 0) break;

      for (const r of pageReviews) {
        if (collected.length >= maxReviews) break;
        push(r);
      }

      const hasNext = !!doc.querySelector(SELECTORS.nextPageLink);
      if (!hasNext) break;
      pageNumber += 1;
    }

    return collected.slice(0, maxReviews);
  }

  async function fetchProducts(titanUrl, token, storeId) {
    const resp = await gmFetch(`${titanUrl}/api/products/list?store_id=${encodeURIComponent(storeId)}&limit=200`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (resp.status >= 400) throw new Error(`Failed to load products (HTTP ${resp.status})`);
    const body = JSON.parse(resp.responseText);
    return body.products || [];
  }

  async function fetchStores(titanUrl, token) {
    const resp = await gmFetch(`${titanUrl}/api/system?action=stores_list`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (resp.status >= 400) throw new Error(`Failed to load stores (HTTP ${resp.status})`);
    const body = JSON.parse(resp.responseText);
    // stores_list returns a bare array (not { stores: [...] }) — see lib/actions/stores.js:
    // the frontend StoreProvider .find()/.map()s the response body directly, so wrapping
    // it would break the dashboard's store switcher. Handle both shapes defensively in
    // case that ever changes, but the bare-array case is the real current contract.
    return Array.isArray(body) ? body : (body.stores || []);
  }

  function submitImport(titanUrl, token, storeId, productId, reviews) {
    return gmFetch(`${titanUrl}/api/system?action=import_amazon_reviews`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, product_id: productId, reviews }),
    });
  }

  function showToast(message, isError) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = [
      'position:fixed', 'bottom:80px', 'right:24px', 'z-index:100000',
      `background:${isError ? '#5a1a1a' : '#1a3a1a'}`, 'color:#fff',
      'border-radius:8px', 'padding:12px 18px', 'font-size:13px', 'max-width:320px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  async function openImportModal(asin) {
    const { token, titanUrl } = getConfig();

    let stores;
    try {
      stores = await fetchStores(titanUrl, token);
    } catch (err) {
      showToast(`Could not load stores: ${err.message}`, true);
      return;
    }
    if (!stores.length) {
      showToast('No stores available for your account.', true);
      return;
    }

    const storeNames = stores.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const storeChoice = window.prompt(`Select a store (enter number):\n${storeNames}`, '1');
    const storeIdx = parseInt(storeChoice, 10) - 1;
    if (!Number.isFinite(storeIdx) || !stores[storeIdx]) {
      showToast('Import cancelled — no store selected.', true);
      return;
    }
    const store = stores[storeIdx];

    let products;
    try {
      products = await fetchProducts(titanUrl, token, store.id);
    } catch (err) {
      showToast(`Could not load products: ${err.message}`, true);
      return;
    }

    const search = window.prompt('Search Titan products by title (leave blank to list first 20):', '');
    const filtered = (search
      ? products.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
      : products
    ).slice(0, 20);

    if (!filtered.length) {
      showToast('No matching products found.', true);
      return;
    }

    const productNames = filtered.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
    const productChoice = window.prompt(`Select a product (enter number):\n${productNames}`, '1');
    const productIdx = parseInt(productChoice, 10) - 1;
    if (!Number.isFinite(productIdx) || !filtered[productIdx]) {
      showToast('Import cancelled — no product selected.', true);
      return;
    }
    const product = filtered[productIdx];

    const maxInput = window.prompt('How many reviews to import? (max 50)', '50');
    const maxReviews = Math.min(50, Math.max(1, parseInt(maxInput, 10) || 50));

    showToast(`Scraping up to ${maxReviews} reviews…`, false);
    let reviews;
    try {
      reviews = await scrapeReviews(asin, maxReviews);
    } catch (err) {
      showToast(`Scrape failed: ${err.message}`, true);
      return;
    }

    if (!reviews.length) {
      showToast('0 reviews found — DOM may have changed, check console.', true);
      console.warn('[titan-userscript] 0 reviews scraped for ASIN', asin);
      return;
    }

    try {
      const resp = await submitImport(titanUrl, token, store.id, product.id, reviews);
      if (resp.status === 401) {
        showToast('API token invalid — regenerate in Titan Settings > Users.', true);
        return;
      }
      if (resp.status === 429) {
        showToast('Titan rate limit hit — wait a bit and retry.', true);
        return;
      }
      if (resp.status >= 400) {
        showToast(`Import failed (HTTP ${resp.status}).`, true);
        return;
      }
      const body = JSON.parse(resp.responseText);
      showToast(`${body.inserted} reviews imported, ${body.duplicates} duplicates.`, false);
    } catch (err) {
      showToast(`Import failed: ${err.message}`, true);
    }
  }

  function promptForToken() {
    const current = GM_getValue('TITAN_API_TOKEN', '');
    const next = window.prompt('Paste your Titan API token (Settings > Users > Generate API token):', current);
    if (next && next.trim()) {
      GM_setValue('TITAN_API_TOKEN', next.trim());
      window.alert('Titan API token saved.');
    }
  }

  // Only these hosts may receive the bearer api_token. Blocks socially-engineered
  // "change your Titan URL to https://faster-mirror.example" token exfiltration (I-4).
  const ALLOWED_TITAN_HOSTS = ['titan-commerce.vercel.app', 'localhost:3000', 'localhost:5173'];

  function promptForUrl() {
    const current = GM_getValue('TITAN_URL', DEFAULT_TITAN_URL);
    const next = window.prompt('Titan dashboard URL:', current);
    if (next === null) return; // cancelled
    const trimmed = next.trim().replace(/\/$/, '');
    if (!trimmed) return;
    let host;
    try {
      host = new URL(trimmed).host;
    } catch {
      window.alert('Invalid URL — must be a full https:// URL');
      return;
    }
    if (!ALLOWED_TITAN_HOSTS.includes(host)) {
      window.alert(`URL host "${host}" not allowed. Only titan-commerce.vercel.app is permitted (or localhost:3000 / localhost:5173 for dev).`);
      return;
    }
    GM_setValue('TITAN_URL', trimmed);
    window.alert('Titan URL saved.');
  }

  GM_registerMenuCommand('Configure Titan API token', promptForToken);
  GM_registerMenuCommand('Configure Titan URL', promptForUrl);

  // Amazon product pages: /dp/{ASIN} or /product-reviews/{ASIN}
  function extractAsin() {
    const m = window.location.pathname.match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }

  function injectButton(asin) {
    if (document.getElementById('titan-import-btn')) return; // already injected
    const btn = document.createElement('button');
    btn.id = 'titan-import-btn';
    btn.textContent = 'Import to Titan';
    btn.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
      'background:#1a1a2e', 'color:#fff', 'border:1px solid #4a4a6a',
      'border-radius:8px', 'padding:12px 18px', 'font-size:14px', 'font-weight:600',
      'cursor:pointer', 'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
    ].join(';');

    btn.addEventListener('click', () => {
      const { token } = getConfig();
      if (!token) {
        window.alert('No API token configured — go to Titan Settings > Users to generate one, then use the Tampermonkey menu (Configure Titan API token) to paste it in.');
        return;
      }
      openImportModal(asin);
    });

    document.body.appendChild(btn);
  }

  function init() {
    const asin = extractAsin();
    if (!asin) return; // not a product/review page
    injectButton(asin);

    const { token, titanUrl } = getConfig();
    console.info('[Titan Importer] loaded, config:', { hasToken: !!token, titanUrl, asin });
  }

  init();
})();
