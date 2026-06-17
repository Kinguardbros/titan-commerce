import { describe, it, expect, vi, beforeAll } from 'vitest';

// reviews-import.js imports reviews-shared (creates a Supabase client at import).
let parseReviewsCsv;
beforeAll(async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  ({ parseReviewsCsv } = await import('../lib/actions/reviews-import.js'));
});

const HEADER = 'author,rating,title,body,date,photo_url,verified';

describe('parseReviewsCsv', () => {
  it('parses a simple row and drops the header', () => {
    const rows = parseReviewsCsv(`${HEADER}\nMaria,5,Great,Loved it,2024-06-10,,1`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ author: 'Maria', rating: 5, title: 'Great', body: 'Loved it', verified: true });
  });

  it('respects quoted fields with embedded commas', () => {
    const rows = parseReviewsCsv(`${HEADER}\nJane,4,"Nice, really","Good, but big",2024-06-08,,`);
    expect(rows[0].title).toBe('Nice, really');
    expect(rows[0].body).toBe('Good, but big');
    expect(rows[0].verified).toBe(false);
  });

  it('handles "" escaping and quoted newlines', () => {
    const rows = parseReviewsCsv(`${HEADER}\nAmy,5,"She said ""wow""","line1\nline2",,,yes`);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('She said "wow"');
    expect(rows[0].body).toBe('line1\nline2');
    expect(rows[0].verified).toBe(true);
  });

  it('handles CRLF line endings and skips blank lines', () => {
    const rows = parseReviewsCsv(`${HEADER}\r\nA,5,t,b,,,\r\n\r\nB,3,u,c,,,`);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.author)).toEqual(['A', 'B']);
  });

  it('coerces verified variants and parses rating as int', () => {
    const rows = parseReviewsCsv(`${HEADER}\nX,2,t,b,,,TRUE\nY,5,t,b,,,0`);
    expect(rows[0].verified).toBe(true);
    expect(rows[1].verified).toBe(false);
    expect(rows[0].rating).toBe(2);
  });

  it('returns empty for header-only or empty input', () => {
    expect(parseReviewsCsv(HEADER)).toEqual([]);
    expect(parseReviewsCsv('')).toEqual([]);
  });
});
