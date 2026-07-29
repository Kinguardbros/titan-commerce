import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import { scrapeAmazonReviews } from './parser.js';

const PORT = process.env.PORT || 3100;
const EXPECTED_TOKEN = process.env.TITAN_SCRAPER_TOKEN;
const PER_IP_LIMIT = parseInt(process.env.SCRAPER_RATE_LIMIT_PER_IP, 10) || 10;
const GLOBAL_LIMIT = parseInt(process.env.SCRAPER_RATE_LIMIT_GLOBAL, 10) || 20;

if (!EXPECTED_TOKEN || EXPECTED_TOKEN.length < 32) {
  throw new Error('TITAN_SCRAPER_TOKEN missing or too short (min 32 chars). Generate with: openssl rand -hex 32');
}

const EXPECTED_BUF = Buffer.from(EXPECTED_TOKEN);

function requireBearer(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  const provided = auth.slice(7);
  const providedBuf = Buffer.from(provided);
  // Length check MUST precede timingSafeEqual (throws RangeError on length mismatch)
  if (providedBuf.length !== EXPECTED_BUF.length) {
    return res.status(401).json({ error: 'invalid token' });
  }
  if (!crypto.timingSafeEqual(providedBuf, EXPECTED_BUF)) {
    return res.status(401).json({ error: 'invalid token' });
  }
  next();
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, version: '1.0.0', timestamp: new Date().toISOString() });
});

// Per-IP: defends against a single attacker hammering the endpoint.
const perIpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: PER_IP_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_per_ip', hint: `max ${PER_IP_LIMIT}/minute per IP` },
  keyGenerator: (req) =>
    req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
});

// Global: defends the VPS's shared resources (CPU/memory/Amazon reputation) regardless of caller.
const globalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: GLOBAL_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_global', hint: `max ${GLOBAL_LIMIT}/hour total (shared across all callers)` },
  keyGenerator: () => 'global', // single bucket for the whole endpoint
});

// Request ID + structured start/end/duration logging, scoped to /scrape-amazon only.
app.use('/scrape-amazon', (req, res, next) => {
  req.requestId = crypto.randomBytes(6).toString('hex');
  req.startTime = Date.now();
  console.log(`[titan-scraper] req=${req.requestId} start url=${req.body?.amazon_url || 'n/a'}`);
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const duration = Date.now() - req.startTime;
    console.log(
      `[titan-scraper] req=${req.requestId} status=${res.statusCode} duration=${duration}ms url=${req.body?.amazon_url || 'n/a'}`
    );
    return originalJson(body);
  };
  next();
});

// Order matters: rate limits BEFORE auth, so rate-limited callers never pay for
// timingSafeEqual / scrypt work, and auth BEFORE the handler so unauthenticated
// callers never trigger a Puppeteer launch.
app.post('/scrape-amazon', perIpLimiter, globalLimiter, requireBearer, async (req, res) => {
  const { amazon_url, max_reviews } = req.body || {};
  if (!amazon_url) return res.status(400).json({ error: 'amazon_url required' });
  const cap = Math.min(parseInt(max_reviews, 10) || 10, 10); // hard cap 10 per D-12
  try {
    const result = await scrapeAmazonReviews(amazon_url, cap);
    res.status(200).json(result);
  } catch (err) {
    console.error('[titan-scraper] scrape error:', { requestId: req.requestId, amazon_url, error: err.message });
    const status =
      err.status ||
      (err.message.includes('blocked') ? 503 : err.message.includes('Invalid Amazon') ? 400 : 500);
    const body = { error: err.message };
    if (err.retryAfter) body.retryAfter = err.retryAfter;
    res.status(status).json(body);
  }
});

// Central error handler — no `catch (e) {}` swallows
app.use((err, req, res, next) => {
  console.error('[titan-scraper] unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[titan-scraper] listening on 0.0.0.0:${PORT}`);
});
