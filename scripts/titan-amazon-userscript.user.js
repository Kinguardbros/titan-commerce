// ==UserScript==
// @name         Titan Commerce — Reviews Importer
// @namespace    https://titan-commerce.vercel.app/
// @version      2.4.0
// @description  Scrape product reviews (Amazon, Temu, Cupshe, Judge.me stores) and import into Titan Commerce as pending reviews.
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
// @match        https://www.cupshe.com/*
// @match        https://cupshe.com/*
// @match        https://www.swanswaywear.com/*
// @match        https://swanswaywear.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      titan-commerce.vercel.app
// @connect      review.cupshe.com
// @connect      judge.me
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
    // Card selector covers 3 known Amazon layouts:
    // - Classic desktop /dp/ page: <div data-hook="review">
    // - Portal /portal/customer-reviews/ page: <li data-hook="review" class="review">
    // - UK mobile /portal/ page: <div id="R..." data-hook="mobley-review-content">
    //   (no data-hook="review" — uses id starting with R + 12-14 alphanumeric review ID)
    reviewCard: '[data-hook="review"], [data-hook="mobley-review-content"]',
    starRating: 'i[data-hook="review-star-rating"] span.a-icon-alt',
    // Amazon renamed review sub-hooks to camelCase (~2026): reviewTitle, reviewText,
    // reviewRichContentContainer. Keep hyphenated fallbacks for older markup and
    // per-region variance (some Amazon locales still ship the legacy names).
    author: 'span.a-profile-name',
    // Title: new = <h5 data-hook="reviewTitle">, old = <a data-hook="review-title"> <span>
    reviewTitle: '[data-hook="reviewTitle"], a[data-hook="review-title"] span:not([class*="a-color-secondary"]), [data-hook="review-title"] span',
    // Body: new = <div data-hook="reviewText"><div data-hook="reviewRichContentContainer">TEXT</div>
    // Prefer the rich-content container (holds the actual review paragraph, not the "Brief content..." wrapper text)
    reviewBody: '[data-hook="reviewRichContentContainer"], span[data-hook="review-body"] span, [data-hook="reviewText"], span[data-hook="review-body"]',
    // Verified badge: US = "avp-badge", UK mobile = "msrp-avp-badge-linkless"
    verifiedBadge: '[data-hook="avp-badge"], [data-hook="msrp-avp-badge-linkless"]',
    // Photos: new markup uses different classes; support all known variants
    photos: 'div[data-hook="review-image-tile-section"] img, [data-hook="review-image-tile-section"] img, img[data-hook="review-image-tile"], .review-image-tile-section img, img.review-image-tile, .cr-lightbox-image-thumbnail img',
    helpfulText: 'span[data-hook="helpful-vote-statement"], [data-hook="helpful-vote-statement"]',
    reviewDate: 'span[data-hook="review-date"], [data-hook="review-date"]',
    nextPageLink: 'ul.a-pagination li.a-last a',
  };

  // Build a Map<reviewId, posterUrl> from Amazon's mobile video gallery. The gallery
  // sits OUTSIDE review cards (single <span class="reviews-mobile-media-gallery"> for
  // the whole page) but each video thumbnail carries a data-* attribute with a JSON
  // payload containing reviewId + slateImageUrl (the video poster). We match the
  // reviewId back to a review card's id="R..." attribute in extractReviewsFromRoot.
  function extractVideoPostersByReviewId(root) {
    const posters = new Map();
    const triggers = Array.from(root.querySelectorAll('[data-action="reviews:open-mweb-immersive-video-modal"]'));
    for (const t of triggers) {
      const raw = t.getAttribute('data-reviews:open-mweb-immersive-video-modal');
      if (!raw) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.warn('[titan-userscript] failed to parse video gallery payload:', err.message);
        continue;
      }
      if (parsed?.reviewId && parsed?.slateImageUrl) {
        posters.set(parsed.reviewId, parsed.slateImageUrl);
      }
    }
    return posters;
  }

  // Extract review objects from any DOM-tree-like root — used against both
  // the live document (dp/ page reviews) and DOMParser-parsed HTML from
  // paginated /product-reviews/{asin} fetches.
  function extractReviewsFromRoot(root) {
    const cards = Array.from(root.querySelectorAll(SELECTORS.reviewCard));
    const videoPosters = extractVideoPostersByReviewId(root);
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

      // Photo URLs (F08 multi-photo): all images in card + optional video poster.
      // Amazon renders each photo twice (once as lightbox thumbnail with alt='Customer image 1'
      // class 'cr-lightbox-image-thumbnail', once as inline tile with alt='Customer image'
      // class 'review-image-tile') — we dedup by URL. Backend I-3 SSRF gate allows
      // m.media-amazon.com so all these thumbnails will fetch.
      const rawImgUrls = photoEls.map((img) => img.getAttribute('src')).filter(Boolean).map(upgradePhotoUrl);
      const videoPoster = videoPosters.get(card.id);
      const combined = [...(videoPoster ? [upgradePhotoUrl(videoPoster) ] : []), ...rawImgUrls];
      // Dedup by URL, preserving order (video poster first, then unique inline imgs).
      const seen = new Set();
      const photo_urls = combined.filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      }).slice(0, 10);

      return {
        author: anonymizeAuthor(authorEl?.textContent?.trim()),
        rating,
        title: rawTitle.slice(0, 200),
        body: (bodyEl?.textContent?.trim() || '').slice(0, 2000),
        verified: !!verifiedEl,
        photo_urls,
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

  // Client-side dedup key: matches server's dropExistingDuplicates + check_review_duplicates
  // action. Author + first-100-chars of body (mirrors the server's md5(body) unique index).
  function reviewDedupKey(r) {
    return `${r.author}|${(r.body || '').slice(0, 100)}`;
  }

  async function scrapeReviews(asin, harvestLimit) {
    const collected = [];
    const seen = new Set();
    const push = (r) => {
      const k = reviewDedupKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      collected.push(r);
      return true;
    };

    // F11: harvest up to harvestLimit UNIQUE raw candidates (not just maxReviews).
    // Caller (openImportModal) does DB-dedup pre-check + priority-sort + trim.

    // DOM first (current page — sees logged-in session's visible reviews)
    extractReviewsFromDom().forEach(push);

    // Paginated fetch — up to 15 pages. Stops when we have enough harvest OR Amazon
    // returns empty / signed-out shell.
    let pageNumber = 1;
    while (collected.length < harvestLimit && pageNumber <= 50) {
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

    return collected;
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

  // Import is chunked: the backend caps a single request at 200 reviews and downloads
  // review photos inline, so one 500-review POST would risk the Vercel function timeout.
  // Sending IMPORT_CHUNK_SIZE at a time keeps every request well inside both limits and
  // makes a mid-run failure partial rather than total.
  const MAX_REVIEWS_PER_RUN = 500;
  const IMPORT_CHUNK_SIZE = 100;

  function submitImport(titanUrl, token, storeId, productId, reviews, source) {
    return gmFetch(`${titanUrl}/api/system?action=import_amazon_reviews`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_id: storeId, product_id: productId, reviews, source }),
    });
  }

  // Returns {inserted, duplicates, skipped, failedChunks, httpError}. Never throws —
  // a failed chunk is counted and the remaining chunks still run.
  async function submitImportChunked(titanUrl, token, storeId, productId, reviews, source, onProgress) {
    const totals = { inserted: 0, duplicates: 0, skipped: 0, failedChunks: 0, httpError: null };
    for (let i = 0; i < reviews.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = reviews.slice(i, i + IMPORT_CHUNK_SIZE);
      const nth = Math.floor(i / IMPORT_CHUNK_SIZE) + 1;
      const of = Math.ceil(reviews.length / IMPORT_CHUNK_SIZE);
      if (onProgress) onProgress(nth, of, totals.inserted);
      try {
        const resp = await submitImport(titanUrl, token, storeId, productId, chunk, source);
        if (resp.status === 401 || resp.status === 429) {
          totals.httpError = resp.status;
          break; // auth / rate limit won't fix itself on the next chunk
        }
        if (resp.status >= 400) {
          totals.failedChunks += 1;
          totals.httpError = resp.status;
          console.warn('[titan-userscript] chunk failed', { nth, status: resp.status, body: resp.responseText });
          continue;
        }
        const body = JSON.parse(resp.responseText);
        totals.inserted += body.inserted || 0;
        totals.duplicates += body.duplicates || 0;
        totals.skipped += body.skipped || 0;
      } catch (err) {
        totals.failedChunks += 1;
        console.warn('[titan-userscript] chunk threw', { nth, error: err.message });
      }
    }
    return totals;
  }

  // F11: ask backend which of these dedup keys already exist for this product.
  // Returns Set<string> of duplicate keys. On error returns empty Set (fail open —
  // server-side dropExistingDuplicates will catch them at import time anyway).
  async function checkDuplicates(titanUrl, token, storeId, productId, keys) {
    if (!keys.length) return new Set();
    try {
      const resp = await gmFetch(`${titanUrl}/api/system?action=check_review_duplicates`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, product_id: productId, keys }),
      });
      if (resp.status !== 200) return new Set();
      const body = JSON.parse(resp.responseText);
      return new Set(body.duplicates || []);
    } catch (err) {
      console.warn('[titan-userscript] dedup check failed, continuing without pre-filter:', err.message);
      return new Set();
    }
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

  async function scrapeTemuReviews(harvestLimit) {
    // Temu virtualizes review lists — cards get added as user scrolls. We take a snapshot
    // of whatever is currently rendered in DOM. To get more, user scrolls first then clicks.
    // F11: no client-side slice — caller (openImportModal) does dedup + trim.
    void harvestLimit; // Temu can't fetch more, only DOM-visible reviews.
    return extractTemuReviews();
  }

  // Temu product ID lives in URL as -g-<digits>.html
  function extractTemuProductId() {
    const m = window.location.pathname.match(/-g-(\d+)\.html/);
    return m ? m[1] : null;
  }

  // ---------- CUPSHE SCRAPER ----------
  // Cupshe exposes its reviews behind a public JSON API. No DOM scraping needed —
  // we call the endpoint directly with the product's skcCode and iterate pages
  // until all reviews are pulled. Fast (auto-paginate) + reliable (no CSS class churn).
  //
  // Endpoint (observed 2026-08-03):
  //   POST https://review.cupshe.com/api/v1/CFM1001005
  //   headers: content-type application/json, authorization: btn-code (fake, accepted)
  //   body: { skcCode, pageNum, pageSize, siteId:1, siteName:'us', langCode:'en-GB',
  //           sortType:5, ... — minimal fields the endpoint accepts }
  //
  // Response shape:
  //   { data: { count, pageInfo: { total, pages, list: [{account, rating, content,
  //             title, gmtCreate, medias:[], likeNum, ...}], hasNextPage } } }
  const CUPSHE_ENDPOINT = 'https://review.cupshe.com/api/v1/CFM1001005';
  const CUPSHE_PAGE_SIZE = 20;

  // Cupshe product ID = skcCode, embedded in URL tail like -CAA12C4D059AA
  // Format: 3 letters + digits/letters, uppercase, ~13 chars, at end of path.
  function extractCupsheProductId() {
    const m = window.location.pathname.match(/-([A-Z0-9]{10,20})(?:\/|$)/);
    return m ? m[1] : null;
  }

  // Cupshe dates come as "DD/MM/YYYY". Convert to server-friendly "Reviewed on D Month YYYY"
  // so parseAmazonDate() day-first regex catches it. Keeps a single date parser server-side.
  function formatCupsheDate(ddmmyyyy) {
    const m = String(ddmmyyyy || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = parseInt(m[1], 10);
    const monthIdx = parseInt(m[2], 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) return '';
    return `on ${day} ${months[monthIdx]} ${m[3]}`;
  }

  // Extract photo URLs from a Cupshe review's medias array. Structure observed as empty
  // in most reviews but may contain image objects — defensive extraction: try common
  // shapes (string, {url}, {src}, {link}).
  function extractCupshePhotos(medias) {
    if (!Array.isArray(medias) || medias.length === 0) return [];
    const urls = [];
    for (const m of medias) {
      if (!m) continue;
      const url = typeof m === 'string' ? m : (m.url || m.src || m.link || m.mediaUrl);
      if (typeof url === 'string' && url.startsWith('http')) urls.push(url);
    }
    return urls.slice(0, 10);
  }

  async function fetchCupshePage(skcCode, pageNum) {
    const body = {
      skcCode,
      siteId: 1,
      channelId: 1,
      brandId: 1,
      terminalId: 1,
      subTerminal: 1,
      shopId: 1,
      loginMethod: 0,
      currency: 'USD',
      currencyCode: '$',
      lang: 'en-GB',
      langCode: 'en-GB',
      siteName: 'us',
      siteIdList: ['1'],
      skcCodes: [skcCode],
      pageNum,
      pageSize: CUPSHE_PAGE_SIZE,
      sortType: 5,
      rating: '',
      qas: [],
      peopleType: '1',
      visitorType: '1,4',
    };
    const resp = await gmFetch(CUPSHE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'authorization': 'btn-code' },
      body: JSON.stringify(body),
    });
    if (resp.status !== 200) throw new Error(`Cupshe API HTTP ${resp.status}`);
    const parsed = JSON.parse(resp.responseText);
    if (!parsed?.success) throw new Error(`Cupshe API returned ${parsed?.retCode || 'error'}: ${parsed?.retInfo || 'unknown'}`);
    return parsed.data;
  }

  async function scrapeCupsheReviews(skcCode, harvestLimit) {
    // F11: fetch all pages up to harvestLimit UNIQUE candidates. Caller does dedup + trim.
    const collected = [];
    let pageNum = 1;
    while (collected.length < harvestLimit && pageNum <= 50) {
      const data = await fetchCupshePage(skcCode, pageNum);
      const list = data?.pageInfo?.list;
      if (!Array.isArray(list) || list.length === 0) break;

      for (const r of list) {
        if (collected.length >= harvestLimit) break;
        const rating = Number.isFinite(r.rating) ? r.rating : parseInt(r.rating, 10);
        if (!rating || rating < 1 || rating > 5) continue;
        const photos = extractCupshePhotos(r.medias);
        collected.push({
          author: anonymizeAuthor(r.account),
          rating,
          title: (r.title || '').slice(0, 200),
          body: (r.content || '').slice(0, 2000),
          verified: r.source === 'Email' || r.type === 2, // Cupshe email-invite reviews = post-purchase
          photo_urls: photos,
          helpful_count: Number.isFinite(r.likeNum) ? r.likeNum : 0,
          review_date: formatCupsheDate(r.gmtCreate),
        });
      }

      if (!data.pageInfo.hasNextPage) break;
      pageNum += 1;
    }
    return collected;
  }

  // ---------- SCRAPER REGISTRY ----------
  // Each entry: source (server-side value), host regex, id extractor, scrape function
  // Add new e-commerce sites here — no other userscript changes needed.
  // ---------- JUDGE.ME SCRAPER (generic for Shopify stores using Judge.me) ----------
  // Reviews come from Judge.me's public widget API (JSON, paginated 25/page) — no DOM
  // parsing, so it survives theme changes. Works on any @match-listed Shopify store;
  // to support another Judge.me store, add its domain to @match and hostMatch below.
  function extractShopifyHandle() {
    const m = window.location.pathname.match(/\/products\/([a-z0-9-]+)/i);
    return m ? m[1] : null;
  }

  async function scrapeJudgemeReviews(handle, harvestLimit) {
    const pj = await fetch(`/products/${handle}.js`, { credentials: 'same-origin' }).then((r) => r.json());
    const productId = pj?.id;
    const shopDomain = (typeof Shopify !== 'undefined' && Shopify.shop)
      || (typeof unsafeWindow !== 'undefined' && unsafeWindow.Shopify?.shop);
    if (!productId || !shopDomain) throw new Error('Missing Shopify product id or shop domain');

    const base = `https://judge.me/reviews/reviews_for_widget?url=${shopDomain}&shop_domain=${shopDomain}`
      + `&platform=shopify&product_id=${productId}&per_page=25`;
    const out = [];
    let page = 1, totalPages = 1;
    while (page <= totalPages && out.length < harvestLimit) {
      const resp = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: `${base}&page=${page}`,
          onload: (r) => resolve(r),
          onerror: () => reject(new Error('judge.me request failed')),
        });
      });
      const data = JSON.parse(resp.responseText);
      totalPages = data.pagination?.total_pages || 1;
      for (const r of (data.reviews || [])) {
        out.push({
          author: anonymizeAuthor(r.reviewer_name),
          rating: r.rating,
          title: (r.title || '').slice(0, 200),
          body: (r.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          verified: !!r.verified_buyer,
          photo_urls: (r.pictures_urls || []).slice(0, 10),
          helpful_count: r.thumb_up || 0,
          review_date: (r.created_at || '').slice(0, 10),
        });
      }
      page += 1;
      await new Promise((res) => setTimeout(res, 800));
    }
    return out.slice(0, harvestLimit);
  }

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
    {
      source: 'cupshe',
      hostMatch: /(?:^|\.)cupshe\.com$/i,
      extractId: extractCupsheProductId,
      scrape: (id, max) => scrapeCupsheReviews(id, max),
      label: 'Cupshe',
    },
    {
      source: 'judgeme',
      hostMatch: /(?:^|\.)swanswaywear\.com$/i,
      extractId: extractShopifyHandle,
      scrape: (id, max) => scrapeJudgemeReviews(id, max),
      label: 'Judge.me (Swansway)',
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
    // Dan uses this userscript only for Isola right now — filter out Elegance House
    // and Eleganz Haus to skip the extra picker step. If a future store should be
    // eligible, add its slug here.
    const SCRAPER_STORE_ALLOWLIST = new Set(['isola']);
    stores = stores.filter((s) => SCRAPER_STORE_ALLOWLIST.has((s.slug || '').toLowerCase()));
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

    const maxInput = window.prompt('How many reviews to import? (max 500)', '500');
    const maxReviews = Math.min(MAX_REVIEWS_PER_RUN, Math.max(1, parseInt(maxInput, 10) || MAX_REVIEWS_PER_RUN));

    // F11: oversample by 2× so DB-dedup pre-check has room to drop duplicates and still
    // hit maxReviews unique. Hard-capped to bound scrape wall time.
    const harvestLimit = Math.min(maxReviews * 2, 1000);
    showToast(`Scraping up to ${harvestLimit} candidates from ${scraper.label}…`, false);
    let harvested;
    try {
      harvested = await scraper.scrape(productId, harvestLimit);
    } catch (err) {
      showToast(`Scrape failed: ${err.message}`, true);
      return;
    }

    if (!harvested.length) {
      showToast('0 reviews found — DOM may have changed, check console.', true);
      console.warn('[titan-userscript] 0 reviews scraped', { source: scraper.source, productId });
      return;
    }

    // F11: DB-dedup pre-check — ask backend which author+body keys already exist for this
    // product. Drop them from harvest so we can fill maxReviews with brand-new reviews
    // instead of importing 200 candidates where 60 are duplicates and only 140 stick.
    const keys = harvested.map(reviewDedupKey);
    const dupKeys = await checkDuplicates(titanUrl, token, store.id, product.id, keys);
    const fresh = harvested.filter((r) => !dupKeys.has(reviewDedupKey(r)));
    const dbDupCount = harvested.length - fresh.length;
    if (dbDupCount > 0) {
      console.info(`[titan-userscript] pre-filter dropped ${dbDupCount} DB-duplicates from ${harvested.length} candidates`);
    }

    // Priority-sort (photo-first, rating-DESC) → trim to maxReviews.
    const reviews = prioritizeReviews(fresh).slice(0, maxReviews);
    if (!reviews.length) {
      showToast(`0 new reviews — all ${harvested.length} candidates already imported.`, true);
      return;
    }

    try {
      const t = await submitImportChunked(
        titanUrl, token, store.id, product.id, reviews, scraper.source,
        function (nth, of, soFar) {
          if (of > 1) showToast(`Importing batch ${nth}/${of}… (${soFar} in so far)`, false);
        }
      );
      if (t.httpError === 401) {
        showToast('API token invalid — regenerate in Titan Settings > Users.', true);
        return;
      }
      if (t.httpError === 429) {
        showToast(`Titan rate limit hit after ${t.inserted} reviews — wait a bit and re-run (duplicates are skipped).`, true);
        return;
      }
      if (t.failedChunks) {
        showToast(`${t.inserted} reviews imported, ${t.duplicates} duplicates — ${t.failedChunks} batch(es) FAILED (HTTP ${t.httpError}), check console.`, true);
        return;
      }
      showToast(`${t.inserted} reviews imported, ${t.duplicates} duplicates.`, false);
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
