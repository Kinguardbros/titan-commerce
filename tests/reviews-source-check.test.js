import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// P1-18 (Docs/AUDIT-2026-08.md): chk_product_reviews_source was widened across 6 separate
// migration files, each hardcoding its own snapshot of the allow-list. Replaying an older
// file after a newer one landed silently reverted the DB constraint below what the app code
// actually inserts, breaking writes for whichever source shipped most recently. This contract
// test guards the two documents that must stay in sync — the JS insert sites (what the app
// actually writes) and the SQL CHECK constraint (what the DB will accept) — as a cheap,
// source-level static check that doesn't need a live DB connection.
describe('product_reviews.source — app writes stay inside the DB CHECK allow-list', () => {
  const sql = read('sql/consolidate-review-source-check.sql');
  // Requires the parenthesized list to start with a quote — skips the prose comment above the
  // real statement, which describes the shape "CHECK (source IN (<cumulative list...>))" in
  // English but never opens with a quote character.
  const checkList = sql.match(/CHECK\s*\(source IN \(\s*('[^)]*)\)\)/)[1];
  const sqlSources = new Set(
    checkList.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
  );

  it('sql/consolidate-review-source-check.sql CHECK list is non-empty and lowercase kebab/plain', () => {
    expect(sqlSources.size).toBeGreaterThan(0);
    for (const s of sqlSources) {
      expect(s).toBe(s.toLowerCase());
      expect(s).toMatch(/^[a-z0-9-]+$/);
    }
  });

  // Single-literal insert sites: `source: 'xxx'`.
  const literalFiles = [
    'lib/actions/reviews.js', // add_review_manual -> 'manual'
    'lib/actions/reviews-import.js', // import_reviews_csv -> 'csv'
    'lib/actions/reviews-ai.js', // generate_reviews_ai -> 'ai'
    'lib/actions/reviews-public.js', // submit_review_public -> 'web'
  ];

  for (const file of literalFiles) {
    it(`${file}'s literal source: '...' value(s) are all in the DB CHECK allow-list`, () => {
      const content = read(file);
      const matches = [...content.matchAll(/source:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
      expect(matches.length).toBeGreaterThan(0);
      for (const value of matches) {
        expect(sqlSources.has(value)).toBe(true);
      }
    });
  }

  it("reviews-amazon.js's ALLOWED_SOURCES set is fully inside the DB CHECK allow-list", () => {
    const content = read('lib/actions/reviews-amazon.js');
    const setLiteral = content.match(/ALLOWED_SOURCES = new Set\(\[([^\]]*)\]\)/)[1];
    const allowed = setLiteral
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(allowed.length).toBeGreaterThan(0);
    for (const value of allowed) {
      expect(sqlSources.has(value)).toBe(true);
    }
  });

  it('every value in the DB CHECK allow-list is actually reachable from some insert site (no stale entries)', () => {
    const reachable = new Set();
    for (const file of literalFiles) {
      const content = read(file);
      for (const m of content.matchAll(/source:\s*'([a-z0-9-]+)'/g)) reachable.add(m[1]);
    }
    const amazonContent = read('lib/actions/reviews-amazon.js');
    const setLiteral = amazonContent.match(/ALLOWED_SOURCES = new Set\(\[([^\]]*)\]\)/)[1];
    for (const s of setLiteral.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)) {
      reachable.add(s);
    }
    for (const s of sqlSources) {
      expect(reachable.has(s)).toBe(true);
    }
  });
});
