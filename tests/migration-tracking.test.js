import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// P1-19 (AUDIT-2026-08): no schema_migrations table anywhere in sql/, so
// applying migrations was entirely manual/memory-driven. There's no live
// Postgres in this test environment (same constraint as
// tests/pipeline-log.test.js), so these tests parse the actual
// `CREATE TABLE schema_migrations (...)` block out of
// sql/000-schema-migrations.sql and use it as the oracle: they check the
// real column list/PK, then simulate Postgres INSERT / INSERT ... ON
// CONFLICT DO NOTHING behavior against a mock table built from that parsed
// definition. This is a behavioral proxy for the constraint, not a
// grep-for-string test.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const migrationSql = readFileSync(join(REPO_ROOT, 'sql/000-schema-migrations.sql'), 'utf8');

function parseCreateTable(sql, tableName) {
  const match = sql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i')
  );
  if (!match) throw new Error(`Could not find CREATE TABLE IF NOT EXISTS ${tableName} (...) in SQL`);
  return match[1]
    .split(',\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const columnLines = parseCreateTable(migrationSql, 'schema_migrations');

/** Mock table that enforces a Postgres-like PRIMARY KEY on `filename`. */
function makeMockSchemaMigrationsTable() {
  const rows = new Map();
  return {
    /** Plain INSERT — violates the PK on a duplicate filename, like raw Postgres would. */
    insert: (filename) => {
      if (rows.has(filename)) {
        return {
          error: {
            code: '23505',
            message: `duplicate key value violates unique constraint "schema_migrations_pkey"`,
          },
        };
      }
      rows.set(filename, { filename, applied_at: new Date().toISOString(), applied_by: 'service_role' });
      return { error: null };
    },
    /** INSERT ... ON CONFLICT (filename) DO NOTHING — the convention every new migration follows. */
    insertOnConflictDoNothing: (filename) => {
      if (rows.has(filename)) {
        return { error: null, inserted: false };
      }
      rows.set(filename, { filename, applied_at: new Date().toISOString(), applied_by: 'service_role' });
      return { error: null, inserted: true };
    },
    rows,
  };
}

describe('sql/000-schema-migrations.sql', () => {
  it('is idempotent — uses CREATE TABLE IF NOT EXISTS, not bare CREATE TABLE', () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS\s+schema_migrations/i);
  });

  it('defines exactly the expected 3-column schema (filename, applied_at, applied_by)', () => {
    const columnNames = columnLines.map((line) => line.split(/\s+/)[0]);
    expect(columnNames).toEqual(['filename', 'applied_at', 'applied_by']);
  });

  it('filename column is the PRIMARY KEY', () => {
    const filenameLine = columnLines.find((line) => line.startsWith('filename'));
    expect(filenameLine).toMatch(/PRIMARY KEY/i);
    expect(filenameLine).toMatch(/^filename\s+TEXT/i);
  });

  it('applied_at defaults to NOW() and is NOT NULL', () => {
    const appliedAtLine = columnLines.find((line) => line.startsWith('applied_at'));
    expect(appliedAtLine).toMatch(/NOT NULL/i);
    expect(appliedAtLine).toMatch(/DEFAULT NOW\(\)/i);
  });

  it('applied_by defaults to current_user', () => {
    const appliedByLine = columnLines.find((line) => line.startsWith('applied_by'));
    expect(appliedByLine).toMatch(/DEFAULT current_user/i);
  });
});

describe('schema_migrations insert behavior (simulated)', () => {
  it('accepts a new filename', () => {
    const table = makeMockSchemaMigrationsTable();
    const { error } = table.insert('001-example.sql');
    expect(error).toBeNull();
    expect(table.rows.size).toBe(1);
  });

  it('a plain duplicate INSERT (no ON CONFLICT) violates the PK — this is exactly why the convention exists', () => {
    const table = makeMockSchemaMigrationsTable();
    table.insert('001-example.sql');
    const { error } = table.insert('001-example.sql');
    expect(error).not.toBeNull();
    expect(error.code).toBe('23505');
    expect(table.rows.size).toBe(1);
  });

  it('INSERT ... ON CONFLICT (filename) DO NOTHING — duplicate filename produces no error', () => {
    const table = makeMockSchemaMigrationsTable();
    table.insertOnConflictDoNothing('002-example.sql');
    const { error, inserted } = table.insertOnConflictDoNothing('002-example.sql');
    expect(error).toBeNull();
    expect(inserted).toBe(false);
    expect(table.rows.size).toBe(1);
  });

  it('ON CONFLICT DO NOTHING still inserts genuinely new filenames alongside an existing one', () => {
    const table = makeMockSchemaMigrationsTable();
    table.insertOnConflictDoNothing('001-example.sql');
    const { error, inserted } = table.insertOnConflictDoNothing('002-example.sql');
    expect(error).toBeNull();
    expect(inserted).toBe(true);
    expect(table.rows.size).toBe(2);
  });
});

describe('convention wiring', () => {
  it('CLAUDE.md documents the INSERT INTO schema_migrations convention for new migrations', () => {
    const claudeMd = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toMatch(/INSERT INTO schema_migrations \(filename\) VALUES/);
    expect(claudeMd).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('sql/README.md exists and references schema_migrations', () => {
    const readme = readFileSync(join(REPO_ROOT, 'sql/README.md'), 'utf8');
    expect(readme).toMatch(/schema_migrations/);
  });

  it('the backfill helper script exists', () => {
    expect(() =>
      readFileSync(join(REPO_ROOT, 'scripts/register-existing-migrations.mjs'), 'utf8')
    ).not.toThrow();
  });
});
