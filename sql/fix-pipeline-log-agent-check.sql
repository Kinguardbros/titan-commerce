-- Fix pipeline_log.agent CHECK constraint to allow all agents actually used
-- in code. Previously constrained to just 4 legacy values (SCRAPER, FORGE,
-- PUBLISHER, LOOPER) — every other agent value inserted by the codebase
-- silently no-op'd because callers don't check insert() response errors.
-- This migration makes the schema match reality and unblocks pipeline_log
-- visibility for all shipped features. Run in Supabase SQL Editor. No
-- BEGIN/COMMIT — editor runs single statements.
--
-- NOTE: CLAUDE.md:130 documents 17 agent names in use, but a repo-wide grep
-- (2026-08-17) of `agent: '...'` literals across lib/ and api/ found 3 more
-- actually inserted that CLAUDE.md doesn't mention: AMAZON_SCRAPER
-- (lib/actions/reviews-amazon.js), AUTH_ADMIN (lib/actions/users.js), and
-- MASTER (api/auth/login.js master-password login path). Included here too
-- — omitting them would leave those three insert paths still silently
-- broken. LOOPER is kept for backward compatibility even though no current
-- code path inserts it (legacy value from the original schema.sql).

ALTER TABLE pipeline_log DROP CONSTRAINT IF EXISTS pipeline_log_agent_check;

ALTER TABLE pipeline_log ADD CONSTRAINT pipeline_log_agent_check
  CHECK (agent IN (
    -- Legacy 4 (from original schema.sql)
    'SCRAPER', 'FORGE', 'PUBLISHER', 'LOOPER',
    -- Wave-added agents documented in CLAUDE.md:130
    'OPTIMIZER', 'IMPORTER', 'PRICING', 'CLEANUP', 'AUTH',
    'SKILL_GEN', 'STYLE_GEN', 'AVATAR', 'EDITOR', 'SIZE_CHART',
    'DOC_PROCESSOR', 'REVIEWS', 'AGENT',
    -- Actually inserted by code but missing from CLAUDE.md:130 (found via
    -- repo-wide grep, not just the documented list)
    'AMAZON_SCRAPER', 'AUTH_ADMIN', 'MASTER'
  ));
