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
  it('PUBLIC_ACTIONS (auth.js) and CORS_ACTIONS (system.js) list the same actions', () => {
    const pub = read('lib/auth.js').match(/PUBLIC_ACTIONS = new Set\(\[([^\]]*)\]/)[1];
    const cors = read('api/system.js').match(/CORS_ACTIONS = new Set\(\[([^\]]*)\]/)[1];
    const norm = (s) => s.split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean).sort();
    expect(norm(pub)).toEqual(norm(cors));
  });
});
