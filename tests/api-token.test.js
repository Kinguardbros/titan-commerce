import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('sql/add-user-api-token.sql', () => {
  it('adds an api_token TEXT UNIQUE column to users', () => {
    const sql = readFileSync('sql/add-user-api-token.sql', 'utf8');
    expect(sql).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token TEXT UNIQUE/);
  });

  it('creates a partial index on api_token for auth lookup performance', () => {
    const sql = readFileSync('sql/add-user-api-token.sql', 'utf8');
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_users_api_token ON users\(api_token\) WHERE api_token IS NOT NULL/);
  });
});
