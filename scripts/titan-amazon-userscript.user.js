// ==UserScript==
// @name         Titan Commerce — Reviews Importer
// @namespace    https://titan-commerce.vercel.app/
// @version      2.0.0
// @description  Scrape product reviews (Amazon, Temu) and import into Titan Commerce as pending reviews.
// @author       Dan
// @match        https://www.amazon.com/*
// @match        https://smile.amazon.com/*
// @match        https://www.amazon.co.uk/*
// @match        https://www.amazon.de/*
// @match        https://www.amazon.fr/*
// @match        https://www.amazon.it/*
// @match        https://www.amazon.es/*
// @match        https://www.amazon.nl/*
// @match        https://www.amazon.pl/*
// @match        https://www.amazon.se/*
// @match        https://www.amazon.ca/*
// @match        https://www.amazon.com.au/*
// @match        https://www.amazon.com.mx/*
// @match        https://www.temu.com/*
// @match        https://temu.com/*
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
    // Tag-agnostic: dp/ page uses <div data-hook="review">, portal/customer-reviews/
    // page uses <li data-hook="review" class="review">. Both hit this.
    reviewCard: '[data-hook="review"]',
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

      // Portal reviews page (/portal/customer-reviews/) puts the star rating text
      // INSIDE the title element ('5.0 out of 5 stars\n\nMy first bikini'). Classic
      // /dp/ page keeps them separate. Strip the star-rating prefix + collapse
      // whitespace so we get just the title. No-op on classic pages where the
      // prefix isn't there.
      const rawTitle = (titleEl?.textContent || '').replace(/^\s*\d(?:\.\d)?\s+out of \d(?:\.\d)?\s+stars?\s*/i, '').replace(/\s+/g, ' ').trim();

      return {
        author: anonymizeAuthor(authorEl?.textContent?.trim()),
        rating,
        title: rawTitle.slice(0, 200),
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
  // Photo-first, rating-DESC sorter — mirrors backend's prioritizeReviews so the top
  // maxReviews the userscript sends are already the highest-quality (photo reviews first,
  // then best-rated non-photo). Server re-applies the same logic as belt-and-suspenders.
  function prioritizeReviews(reviews) {
    const hasPhoto = (r) => Array.isArray(r.photo_urls) && r.photo_urls.length > 0;
    return [...reviews].sort((a, b) => {
      const pa = hasPhoto(a) ? 1 : 0;
      const pb = hasPhoto(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (b.rating || 0) - (a.rating || 0);
    });
  }

  async function scrapeReviews(asin, maxReviews) {
    const collected = [];
    const seen = new Set();
    const dedupKey = (r) => `${r.author}|${(r.body || '').slice(0, 100)}`;
    const push = (r) => {
      const k = dedupKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      collected.push(r);
      return true;
    };

    // Collect up to 3× maxReviews raw candidates so priority-sort has real headroom
    // (otherwise we'd stop at the first 50 chronologically and never see photo reviews
    // on later pages). Hard-cap the harvest at 300 to bound fetch time.
    const harvestTarget = Math.min(maxReviews * 3, 300);

    // DOM first (current page — sees logged-in session's visible reviews)
    extractReviewsFromDom().forEach(push);

    // Paginated fetch — up to 10 pages. Stops when we have enough harvest OR Amazon
    // returns empty / signed-out shell.
    let pageNumber = 1;
    while (collected.length < harvestTarget && pageNumber <= 10) {
      const url = `https://${window.location.hostname}/product-reviews/${asin}/?sortBy=recent&pageNumber=${pageNumber}`;
      const resp = await gmFetch(url, { method: 'GET' });
      if (resp.status >= 400) break;

      const doc = new DOMParser().parseFromString(resp.responseText, 'text/html');
      const pageReviews = extractReviewsFromRoot(doc);
      if (pageReviews.length === 0) break;

      pageReviews.forEach(push);

      const hasNext = !!doc.querySelector(SELECTORS.nextPageLink);
      if (!hasNext) break;
      pageNumber += 1;
    }

    // Priority-sort, then take top maxReviews.
    return prioritizeReviews(collected).slice(0, maxReviews);
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

  function submitImport(titanUrl, token, storeId, productId, reviews, source) {
    return gmFetch(`${titanUrl}/api/system?action=import_amazon_reviews`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, product_id: productId, reviews, source }),
    });
  }

  // ---------- TEMU SCRAPER ----------
  // Temu review card = div._9WTBQrvq (obfuscated by webpack, will break on their next
  // redeploy — that's the accepted tradeoff for skipping the AI parser path).
  // Photos aren't in dp/ page cards (Temu lazy-loads them behind a modal we can't hit
  // without user interaction), so photo_urls is always empty for Temu imports.
  const TEMU_SELECTORS = {
    reviewCard: 'div._9WTBQrvq',
    body: 'div._2EO0yd2j',
    author: 'div.XTEkYdlM',
    ratingAria: '[aria-label*="out of five stars" i]',
    dateAria: '[aria-label*="on " i]',
    // Review photos: identified by alt="Reviews image" OR src containing /review-image/
    // (avatars and country flags share the base class wxWpAMbp so filtering by class won't work).
    photos: 'img[alt="Reviews image"], img[src*="/review-image/"]',
  };

  // Temu photo URLs come as low-res thumbnails (?imageMogr2/auto-orient|imageView2/2/w/236/q/7).
  // Strip the querystring to get the higher-res original URL from the same origin.
  // Backend I-3 SSRF gate needs updating to allow this Temu CDN host (rewimg-eu.kwcdn.com).
  function upgradeTemuPhotoUrl(url) {
    if (!url) return url;
    const q = url.indexOf('?');
    return q > 0 ? url.slice(0, q) : url;
  }

  function extractTemuReviews() {
    const cards = Array.from(document.querySelectorAll(TEMU_SELECTORS.reviewCard));
    return cards.map((card) => {
      const bodyEl = card.querySelector(TEMU_SELECTORS.body);
      const authorEl = card.querySelector(TEMU_SELECTORS.author);
      const ratingEl = card.querySelector(TEMU_SELECTORS.ratingAria);
      const dateEl = card.querySelector(TEMU_SELECTORS.dateAria);
      const photoEls = Array.from(card.querySelectorAll(TEMU_SELECTORS.photos));

      // Rating from "5 out of five stars" aria-label
      const ratingMatch = ratingEl?.getAttribute('aria-label')?.match(/^(\d)\s+out of five/i);
      const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : null;
      if (rating === null) return null;

      // Date from "in Czech Republic on 20 Apr 2024" aria-label — server parses "on <date>"
      const dateAria = dateEl?.getAttribute('aria-label') || '';

      const body = (bodyEl?.textContent?.trim() || '').slice(0, 2000);
      // Skip cards with no body text — they're probably UI shells that matched selector
      if (!body) return null;

      // Take the first photo only (server accepts 1 photo_url per review).
      const photo_urls = photoEls
        .map((img) => upgradeTemuPhotoUrl(img.getAttribute('src')))
        .filter(Boolean)
        .slice(0, 1);

      return {
        author: anonymizeAuthor(authorEl?.textContent?.trim()),
        rating,
        title: '', // Temu reviews don't have separate titles
        body,
        verified: true, // Temu shows "All reviews are from verified purchases" globally
        photo_urls,
        helpful_count: 0, // Temu doesn't expose per-review helpful counts on dp/ page
        review_date: dateAria,
      };
    }).filter(Boolean);
  }

  async function scrapeTemuReviews(maxReviews) {
    // Temu virtualizes review lists — cards get added as user scrolls. We take a snapshot
    // of whatever is currently rendered in DOM. To get more, user scrolls first then clicks.
    // Photos are per-card (img[alt="Reviews image"]) — priority sort brings photo reviews
    // to the front so the top maxReviews we send are the highest-quality ones.
    return prioritizeReviews(extractTemuReviews()).slice(0, maxReviews);
  }

  // Temu product ID lives in URL as -g-<digits>.html
  function extractTemuProductId() {
    const m = window.location.pathname.match(/-g-(\d+)\.html/);
    return m ? m[1] : null;
  }

  // ---------- SCRAPER REGISTRY ----------
  // Each entry: source (server-side value), host regex, id extractor, scrape function
  // Add new e-commerce sites here — no other userscript changes needed.
  const SCRAPERS = [
    {
      source: 'amazon',
      hostMatch: /(?:^|\.)amazon\.[a-z.]+$/i,
      extractId: extractAsin,
      scrape: (id, max) => scrapeReviews(id, max),
      label: 'Amazon',
    },
    {
      source: 'temu',
      hostMatch: /(?:^|\.)temu\.com$/i,
      extractId: extractTemuProductId,
      scrape: (id, max) => scrapeTemuReviews(max),
      label: 'Temu',
    },
  ];

  function pickScraper() {
    const host = window.location.hostname;
    return SCRAPERS.find((s) => s.hostMatch.test(host)) || null;
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

  async function openImportModal(scraper, productId) {
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

    const maxInput = window.prompt('How many reviews to import? (max 100)', '100');
    const maxReviews = Math.min(100, Math.max(1, parseInt(maxInput, 10) || 100));

    showToast(`Scraping up to ${maxReviews} reviews from ${scraper.label}…`, false);
    let reviews;
    try {
      reviews = await scraper.scrape(productId, maxReviews);
    } catch (err) {
      showToast(`Scrape failed: ${err.message}`, true);
      return;
    }

    if (!reviews.length) {
      showToast('0 reviews found — DOM may have changed, check console.', true);
      console.warn('[titan-userscript] 0 reviews scraped', { source: scraper.source, productId });
      return;
    }

    try {
      const resp = await submitImport(titanUrl, token, store.id, product.id, reviews, scraper.source);
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
    // Supported URL forms:
    //   /dp/{ASIN}                                  — product detail page
    //   /gp/product/{ASIN}                          — legacy product URL
    //   /product-reviews/{ASIN}                     — classic reviews page
    //   /portal/customer-reviews/{ASIN}             — new "portal" reviews page (2026+)
    //   /portal/customer-reviews/srp/-/{REVIEW_ID}  — single-review page (no ASIN — ignore)
    const m = window.location.pathname.match(/\/(?:dp|product-reviews|gp\/product|portal\/customer-reviews)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return m ? m[1].toUpperCase() : null;
  }

  function injectButton(scraper, productId) {
    if (document.getElementById('titan-import-btn')) return; // already injected
    const btn = document.createElement('button');
    btn.id = 'titan-import-btn';
    btn.textContent = `Import to Titan (${scraper.label})`;
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
      openImportModal(scraper, productId);
    });

    document.body.appendChild(btn);
  }

  function init() {
    const scraper = pickScraper();
    if (!scraper) return; // domain not registered — do nothing
    const productId = scraper.extractId();
    if (!productId) return; // not a product page for this domain
    injectButton(scraper, productId);

    const { token, titanUrl } = getConfig();
    console.info('[Titan Importer] loaded', { source: scraper.source, hasToken: !!token, titanUrl, productId });
  }

  init();
})();
