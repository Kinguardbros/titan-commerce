import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Anthropic retires model ids. `claude-sonnet-4-20250514` was pinned at 16 call sites across
// 8 files and started returning `404 not_found_error` — every Claude-backed feature (product
// optimizer, review generation, custom styles, size-chart vision, skill gen, doc processing,
// garment-length detection) died silently in prod, and the suite stayed green the whole time
// because every one of those calls is mocked. Nothing in the codebase tied a pinned id to the
// set of ids the API will actually serve.
//
// This is that tie: a source-level contract over every Claude model id the backend pins.
// It needs no network and no API key, so it runs in CI like any other test.
//
// Refreshing the allow-list when a new model ships:
//   curl -s "https://api.anthropic.com/v1/models?limit=100" \
//     -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"
// Add the new id here, then move the call sites. Removing an id from this list is the signal
// that a migration is due — the test names every file still pinning it.
const SUPPORTED_MODELS = new Set([
  'claude-opus-5',
  'claude-sonnet-5',
]);

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) out.push(...jsFilesUnder(rel));
    else if (entry.endsWith('.js')) out.push(rel);
  }
  return out;
}

// `model:` is also used for non-Claude pins (fal.ai / Higgsfield model keys), so match on the
// `claude-` prefix rather than on the property name alone.
const MODEL_PIN = /['"](claude-[a-z0-9.-]+)['"]/g;

describe('pinned Claude model ids are ones the API still serves', () => {
  const files = [...jsFilesUnder('lib'), ...jsFilesUnder('api')];

  it('finds the Claude call sites at all (guards the scanner itself)', () => {
    const withPins = files.filter((f) => readFileSync(join(root, f), 'utf8').match(MODEL_PIN));
    // If a refactor moves every pin behind a shared constant this drops to 0 and the test
    // above would pass vacuously — fail loudly instead so the guard gets pointed at the
    // new location rather than silently guarding nothing.
    expect(withPins.length).toBeGreaterThan(0);
  });

  it('pins no model id outside the supported set', () => {
    const violations = [];
    for (const file of files) {
      const content = readFileSync(join(root, file), 'utf8');
      for (const match of content.matchAll(MODEL_PIN)) {
        const id = match[1];
        if (!SUPPORTED_MODELS.has(id)) {
          // match.index, not indexOf(id) — a file pinning the same id N times would
          // otherwise report the first line N times and hide the other call sites.
          const line = content.slice(0, match.index).split('\n').length;
          violations.push(`${relative('.', file)}:${line} pins '${id}'`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
