import express from 'express';
import crypto from 'crypto';
import 'dotenv/config';
import { scrapeAmazonReviews } from './parser.js';

const PORT = process.env.PORT || 3100;
const EXPECTED_TOKEN = process.env.TITAN_SCRAPER_TOKEN;

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

app.post('/scrape-amazon', requireBearer, async (req, res) => {
  const { amazon_url, max_reviews } = req.body || {};
  if (!amazon_url) return res.status(400).json({ error: 'amazon_url required' });
  const cap = Math.min(parseInt(max_reviews, 10) || 10, 10); // hard cap 10 per D-12
  try {
    const result = await scrapeAmazonReviews(amazon_url, cap);
    res.status(200).json(result);
  } catch (err) {
    console.error('[titan-scraper] scrape error:', err);
    const status = err.message.includes('blocked')
      ? 503
      : err.message.includes('Invalid Amazon')
        ? 400
        : 500;
    res.status(status).json({ error: err.message });
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
