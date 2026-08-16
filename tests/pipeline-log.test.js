import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// P0-7 (AUDIT-2026-08): pipeline_log.agent CHECK constraint was stuck at 4
// legacy values while the codebase grew to insert ~20. There's no live
// Postgres in this test environment (vitest mocks Supabase everywhere else
// in this repo — see tests/reviews-amazon.test.js etc.), so these tests use
// the migration SQL file itself as the oracle: they parse the actual
// `CHECK (agent IN (...))` list out of sql/fix-pipeline-log-agent-check.sql
// and sql/schema.sql, then simulate Postgres CHECK-constraint enforcement
// against that parsed list. This is a real behavioral proxy for the
// constraint (accept/reject), not a grep-for-string test, and it fails if
// either SQL file's list drifts from the other or omits a value.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

function parseCheckAgentList(sql) {
  const match = sql.match(/CHECK\s*\(\s*agent\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
  if (!match) throw new Error('Could not find `CHECK (agent IN (...))` in SQL');
  // Strip `-- ...` line comments BEFORE splitting on commas — comment prose
  // (e.g. "found via repo-wide grep, not just...") can itself contain
  // commas, which would otherwise corrupt the split.
  const withoutComments = match[1].replace(/--.*$/gm, '');
  return withoutComments
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^'|'$/g, ''));
}

const migrationSql = readFileSync(join(REPO_ROOT, 'sql/fix-pipeline-log-agent-check.sql'), 'utf8');
const schemaSql = readFileSync(join(REPO_ROOT, 'sql/schema.sql'), 'utf8');

const migrationAgents = parseCheckAgentList(migrationSql);
const schemaAgents = parseCheckAgentList(schemaSql);

// Canonical list this fix is meant to unblock: 4 legacy + 13 from
// CLAUDE.md:130 + 3 found via repo-wide grep but undocumented there.
const EXPECTED_AGENTS = [
  'SCRAPER', 'FORGE', 'PUBLISHER', 'LOOPER',
  'OPTIMIZER', 'IMPORTER', 'PRICING', 'CLEANUP', 'AUTH',
  'SKILL_GEN', 'STYLE_GEN', 'AVATAR', 'EDITOR', 'SIZE_CHART',
  'DOC_PROCESSOR', 'REVIEWS', 'AGENT',
  'AMAZON_SCRAPER', 'AUTH_ADMIN', 'MASTER',
];

/** Mock Supabase client that enforces a Postgres-like CHECK constraint on `agent`. */
function makeMockPipelineLogTable(allowedAgents) {
  const rows = [];
  return {
    insert: async (row) => {
      if (!allowedAgents.includes(row.agent)) {
        return {
          data: null,
          error: {
            code: '23514',
            message: `new row for relation "pipeline_log" violates check constraint "pipeline_log_agent_check"`,
          },
        };
      }
      rows.push(row);
      return { data: [row], error: null };
    },
    rows,
  };
}

describe('sql/fix-pipeline-log-agent-check.sql', () => {
  it('lists exactly the 20 expected agent values (4 legacy + 13 CLAUDE.md + 3 undocumented-but-used)', () => {
    expect(migrationAgents.sort()).toEqual([...EXPECTED_AGENTS].sort());
  });

  it('sql/schema.sql inline pipeline_log CHECK stays in sync with the migration', () => {
    expect(schemaAgents.sort()).toEqual(migrationAgents.sort());
  });
});

describe('pipeline_log.agent CHECK constraint behavior (simulated)', () => {
  it.each(EXPECTED_AGENTS)('accepts agent %s', async (agent) => {
    const table = makeMockPipelineLogTable(migrationAgents);
    const { error } = await table.insert({ agent, level: 'info', message: `test from ${agent}` });
    expect(error).toBeNull();
    expect(table.rows).toHaveLength(1);
  });

  it('rejects an unknown agent value with a constraint violation', async () => {
    const table = makeMockPipelineLogTable(migrationAgents);
    const { error, data } = await table.insert({ agent: 'FOO', level: 'info', message: 'should not land' });
    expect(error).not.toBeNull();
    expect(error.code).toBe('23514');
    expect(error.message).toMatch(/pipeline_log_agent_check/);
    expect(data).toBeNull();
    expect(table.rows).toHaveLength(0);
  });

  it('legacy SCRAPER entries (the only agent that actually landed in prod per the audit) continue to work', async () => {
    const table = makeMockPipelineLogTable(migrationAgents);
    const { error } = await table.insert({ agent: 'SCRAPER', level: 'info', message: 'Product synced from Shopify' });
    expect(error).toBeNull();
    expect(table.rows[0].agent).toBe('SCRAPER');
  });
});
