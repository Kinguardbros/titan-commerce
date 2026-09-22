import { describe, it, expect, vi } from 'vitest';

// reviews-shared.js vytváří Supabase klienta při importu, takže ho tu jen odstavíme.
// Testované funkce s klientem nepracují, sahají jen na řetězec s URL.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

const { reviewPhotoThumb, withThumbnailPhotos, REVIEW_THUMB_WIDTH } =
  await import('../lib/actions/reviews-shared.js');

const OBJ = 'https://x.supabase.co/storage/v1/object/public/store-docs/isola/Reviews/a/photo_1.jpg';
const RENDER = 'https://x.supabase.co/storage/v1/render/image/public/store-docs/isola/Reviews/a/photo_1.jpg';

describe('reviewPhotoThumb', () => {
  it('turns a Storage object URL into a sized render URL', () => {
    expect(reviewPhotoThumb(OBJ)).toBe(`${RENDER}?width=${REVIEW_THUMB_WIDTH}&quality=70`);
  });

  it('honours an explicit width', () => {
    expect(reviewPhotoThumb(OBJ, 120)).toContain('width=120');
  });

  it('leaves an already-transformed URL alone (no double transform)', () => {
    const once = reviewPhotoThumb(OBJ);
    expect(reviewPhotoThumb(once)).toBe(once);
  });

  it('passes through URLs that are not Supabase Storage', () => {
    const cdn = 'https://cdn.shopify.com/s/files/1/0001/photo.jpg';
    expect(reviewPhotoThumb(cdn)).toBe(cdn);
  });

  it('rejects non-http URLs, so javascript: never reaches the storefront', () => {
    expect(reviewPhotoThumb('javascript:alert(1)')).toBeNull();
    expect(reviewPhotoThumb('')).toBeNull();
    expect(reviewPhotoThumb(null)).toBeNull();
  });
});

describe('withThumbnailPhotos', () => {
  it('maps photo_urls and photo_url without touching the rest of the review', () => {
    const review = { id: 7, rating: 5, body: 'text', photo_url: OBJ, photo_urls: [OBJ, OBJ] };
    const out = withThumbnailPhotos(review);
    expect(out.id).toBe(7);
    expect(out.body).toBe('text');
    expect(out.photo_urls).toHaveLength(2);
    out.photo_urls.forEach((u) => expect(u).toContain('/render/image/'));
    expect(out.photo_url).toContain('/render/image/');
  });

  it('does not mutate the original row', () => {
    const review = { photo_urls: [OBJ] };
    withThumbnailPhotos(review);
    expect(review.photo_urls[0]).toBe(OBJ);
  });

  it('drops unsafe URLs from the array', () => {
    const out = withThumbnailPhotos({ photo_urls: [OBJ, 'javascript:alert(1)'] });
    expect(out.photo_urls).toHaveLength(1);
  });

  it('leaves a review with no photos untouched', () => {
    const out = withThumbnailPhotos({ rating: 4 });
    expect(out).toEqual({ rating: 4 });
  });
});
