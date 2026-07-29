import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { anonymizeAuthor } from './anonymizer.js';

puppeteer.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const PAGE_NAV_TIMEOUT_MS = 30000;
const PAGE_DELAY_MS = 7000; // rate-limit delay between page navs (5-10s window)
const BLOCK_RETRY_DELAY_MS = 30000;
const BODY_MAX_CHARS = 2000;

const SELECTORS = {
  reviewCard: 'div[data-hook="review"]',
  starRating: 'i[data-hook="review-star-rating"] span.a-icon-alt',
  author: 'span.a-profile-name',
  reviewTitle: 'a[data-hook="review-title"] span:not([class*="a-color-secondary"])',
  reviewBody: 'span[data-hook="review-body"] span',
  verifiedBadge: 'span[data-hook="avp-badge"]',
  photos: 'div[data-hook="review-image-tile-section"] img',
  helpfulText: 'span[data-hook="helpful-vote-statement"]',
  reviewDate: 'span[data-hook="review-date"]',
  nextPageLink: 'ul.a-pagination li.a-last a',
  productLink: 'a.a-link-normal[data-hook="product-link"]',
};

const ASIN_RE = /\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/i;

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function extractAsin(amazonUrl) {
  const m = String(amazonUrl || '').match(ASIN_RE);
  if (!m) throw new Error('Invalid Amazon URL — could not extract ASIN');
  return m[1].toUpperCase();
}

function reviewsUrl(asin, pageNumber) {
  return `https://www.amazon.com/product-reviews/${asin}/?pageNumber=${pageNumber}&sortBy=recent`;
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

function parseReviewDate(text) {
  const s = String(text || '');
  const m = s.match(/on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const monthIdx = MONTHS[m[1].toLowerCase()];
  if (monthIdx === undefined) return null;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const d = new Date(Date.UTC(year, monthIdx, day));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function upgradePhotoUrl(url) {
  // Amazon thumb "._SY88_.jpg" -> high-res "._SL1600_.jpg"
  return url.replace(/\._[A-Z]{2}\d+_?\./, '._SL1600_.');
}

async function isBlocked(page) {
  const title = await page.title().catch(() => '');
  return /sorry! something went wrong|robot check|captcha/i.test(title);
}

async function extractReviewsFromPage(page) {
  return page.evaluate((sel) => {
    const cards = Array.from(document.querySelectorAll(sel.reviewCard));
    return cards.map((card) => {
      const starEl = card.querySelector(sel.starRating);
      const authorEl = card.querySelector(sel.author);
      const titleEl = card.querySelector(sel.reviewTitle);
      const bodyEl = card.querySelector(sel.reviewBody);
      const verifiedEl = card.querySelector(sel.verifiedBadge);
      const helpfulEl = card.querySelector(sel.helpfulText);
      const dateEl = card.querySelector(sel.reviewDate);
      const photoEls = Array.from(card.querySelectorAll(sel.photos));
      return {
        rawAuthor: authorEl?.textContent?.trim() || '',
        rawRating: starEl?.textContent?.trim() || '',
        title: titleEl?.textContent?.trim() || '',
        body: bodyEl?.innerText?.trim() || bodyEl?.textContent?.trim() || '',
        verified: !!verifiedEl,
        rawHelpful: helpfulEl?.textContent?.trim() || '',
        rawDate: dateEl?.textContent?.trim() || '',
        photoSrcs: photoEls.map((img) => img.src).filter(Boolean),
      };
    });
  }, SELECTORS);
}

async function extractProductTitle(page) {
  return page
    .evaluate((sel) => {
      const link = document.querySelector(sel.productLink);
      return link?.textContent?.trim() || null;
    }, SELECTORS)
    .catch(() => null);
}

/**
 * Scrapes reviews for a given Amazon product URL (or review-page URL).
 * @param {string} amazonUrl
 * @param {number} maxReviews - caller (server.js) hard-caps this to 10
 * @returns {Promise<{reviews: object[], product: {asin: string, title: string|null}}>}
 */
export async function scrapeAmazonReviews(amazonUrl, maxReviews) {
  const asin = extractAsin(amazonUrl);
  const cap = Number.isFinite(maxReviews) && maxReviews > 0 ? maxReviews : 10;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1366, height: 900 });

    const collected = [];
    let pageNumber = 1;
    let productTitle = null;
    let retriedBlock = false;

    while (collected.length < cap && pageNumber <= 10) {
      const navResponse = await page.goto(reviewsUrl(asin, pageNumber), {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_NAV_TIMEOUT_MS,
      });

      if (navResponse && navResponse.status() === 429) {
        const err = new Error('Amazon rate-limited this request (429) — wait 5 minutes and try again');
        err.status = 503;
        err.retryAfter = 300;
        throw err;
      }

      await page
        .waitForSelector(SELECTORS.reviewCard, { timeout: PAGE_NAV_TIMEOUT_MS })
        .catch(() => {
          console.warn('[titan-scraper] reviewCard did not appear within timeout — possible captcha', {
            asin,
            pageNumber,
          });
        });

      if (await isBlocked(page)) {
        if (retriedBlock) {
          throw new Error('Amazon blocked the scraper (Cloudflare/CAPTCHA)');
        }
        console.warn('[titan-scraper] block detected, retrying once after 30s', { asin, pageNumber });
        retriedBlock = true;
        await new Promise((r) => setTimeout(r, BLOCK_RETRY_DELAY_MS));
        continue; // retry same page, do not advance pageNumber
      }

      if (!productTitle) {
        productTitle = await extractProductTitle(page);
      }

      const rawReviews = await extractReviewsFromPage(page);

      if (rawReviews.length === 0 && pageNumber === 1) {
        // Canary: 0 matches on page 1 — either a review-less product or Amazon's DOM changed.
        const htmlSample = await page
          .content()
          .then((h) => h.slice(0, 500))
          .catch(() => '');
        console.warn(
          '[titan-scraper] Amazon reviewCard selector 0 matches — DOM may have changed. Sample HTML:',
          htmlSample
        );
        return { reviews: [], product: { asin, title: productTitle } };
      }

      if (rawReviews.length === 0) break; // no more reviews on later pages

      for (const raw of rawReviews) {
        if (collected.length >= cap) break;
        const rating = parseRating(raw.rawRating);
        if (rating === null) {
          console.warn('[titan-scraper] skipping review with unparseable rating', {
            asin,
            author: raw.rawAuthor,
          });
          continue;
        }
        collected.push({
          author: anonymizeAuthor(raw.rawAuthor),
          rating,
          title: raw.title,
          body: raw.body.slice(0, BODY_MAX_CHARS),
          verified: raw.verified,
          photo_urls: raw.photoSrcs.slice(0, 1).map(upgradePhotoUrl), // first photo only
          helpful_count: parseHelpfulCount(raw.rawHelpful),
          review_date: parseReviewDate(raw.rawDate),
        });
      }

      if (collected.length >= cap) break;

      const nextEl = await page.$(SELECTORS.nextPageLink);
      if (!nextEl) break;
      const nextDisabled = await page
        .$eval(SELECTORS.nextPageLink, (el) => el.closest('li')?.classList.contains('a-disabled') || false)
        .catch(() => true);
      if (nextDisabled) break;

      pageNumber += 1;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }

    return {
      reviews: collected,
      product: { asin, title: productTitle },
    };
  } finally {
    await browser.close();
  }
}
