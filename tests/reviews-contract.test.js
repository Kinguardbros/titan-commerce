import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Contract guards — cheap source-level assertions for load-bearing invariants that
// would silently break the storefront if a future edit dropped them.
describe('reviews push → metafield contract', () => {
  const push = read('lib/actions/reviews-push.js');
  // The reviews select is the one that lists the per-review fields (author, rating…).
  const reviewSelect = push.match(/\.select\('([^']*author[^']*)'\)/)[1];

  it('reviews_json select includes id (storefront needs it to vote on a review)', () => {
    expect(reviewSelect).toContain('id');
  });

  it('reviews_json select includes helpful_count (storefront shows + sorts by it)', () => {
    expect(reviewSelect).toContain('helpful_count');
  });

  it('push still excludes email from the pushed reviews (never on storefront)', () => {
    expect(reviewSelect).not.toContain('email');
  });
});

describe('auth fails closed without APP_SECRET', () => {
  it('does not fall back to a hardcoded default secret', () => {
    const auth = read('lib/auth.js');
    const login = read('api/auth/login.js');
    expect(auth).not.toContain("'default-secret'");
    expect(login).not.toContain("'default-secret'");
  });
});

describe('public action sets stay in parity', () => {
  // CORS_ACTIONS (system.js) is a per-action origin map: { actionName: string[] }.
  // Every unauthenticated PUBLIC_ACTIONS entry (auth.js) must also get CORS headers
  // (a browser calling it cross-origin needs ACAO), but CORS_ACTIONS may legitimately
  // contain MORE entries — e.g. import_amazon_reviews needs CORS for the Amazon
  // userscript's origin but is NOT public (it still requires bearer api_token auth).
  it('every PUBLIC_ACTIONS (auth.js) action is present as a CORS_ACTIONS (system.js) key', () => {
    const pub = read('lib/auth.js').match(/PUBLIC_ACTIONS = new Set\(\[([^\]]*)\]/)[1];
    const corsBlock = read('api/system.js').match(/const CORS_ACTIONS = \{([\s\S]*?)\n\};/)[1];
    const norm = (s) => s.split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean).sort();
    const pubActions = norm(pub);
    const corsKeys = [...corsBlock.matchAll(/^\s*([a-zA-Z0-9_]+):/gm)].map((m) => m[1]).sort();
    for (const action of pubActions) {
      expect(corsKeys).toContain(action);
    }
  });
});
