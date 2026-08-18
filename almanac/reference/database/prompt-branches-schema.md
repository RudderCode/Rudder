---
title: "Prompt Branches Schema"
summary: "The prompt branches schema reference defines Rudder's local prompt table, Drizzle declaration, migrations, indexes, hook normalization, and helper contracts."
topics: [reference, database, prompt-capture, prompt-history, runtime, sqlite]
sources:
  - id: schema
    type: file
    path: src/db/schema.ts
  - id: prompt-migration
    type: file
    path: drizzle/20260722200723_prompt-branch-links/migration.sql
  - id: previous-output-migration
    type: file
    path: drizzle/20260723191552_capture-previous-agent-output/migration.sql
  - id: specs-migration
    type: file
    path: drizzle/20260818210137_add-local-specs/migration.sql
  - id: db-client
    type: file
    path: src/db/client.ts
  - id: prompt-tagger
    type: file
    path: src/prompt-tagger.ts
  - id: prompt-hook
    type: file
    path: src/prompt-hook.ts
  - id: migrations-test
    type: file
    path: test/migrations.test.ts
  - id: prompt-tests
    type: file
    path: test/prompt-tagger.test.ts
---

# Prompt Branches Schema

The `prompt_branches` table is Rudder's SQLite storage contract for captured prompt intent.
Drizzle declares it beside the `specs` table in `src/db/schema.ts`, generated migrations under `drizzle/` create and extend it at runtime, and `src/prompt-tagger.ts` defines the write, reconciliation, and lookup helper contracts [@schema] [@prompt-migration] [@previous-output-migration] [@prompt-tagger].
This reference covers the prompt table; [Specs Schema](specs-schema) covers the branch-to-local-spec mapping added by the specs migration [@specs-migration].
It is the exact lookup companion to [Prompt Branch Store](../../architecture/runtime/prompt-branch-store), [Prompt History](../../concepts/runtime/prompt-history), and the [generated migrations decision](../../decisions/database/generated-drizzle-migrations).

## Runtime Creation

`openDb()` enables WAL, sets `PRAGMA busy_timeout = 5000`, enables `PRAGMA secure_delete = ON`, constructs a Drizzle client over the same `DatabaseSync` handle, and runs `migrate(orm, { migrationsFolder })` before caching the handles [@db-client].
The migration test opens a new database, asserts that `prompt_branches` and `specs` are the live Rudder tables from the checked set, verifies nullable `previous_agent_output`, verifies the specs table shape, and asserts that Drizzle recorded four applied migrations [@migrations-test] [@specs-migration].

## Columns

| Column | SQLite Migration | Drizzle Declaration | Helper Field |
| --- | --- | --- | --- |
| `source` | `text NOT NULL` [@prompt-migration] | `text('source').notNull()` [@schema] | Trimmed nonblank source such as `claude-code`, `codex`, or `cursor` [@prompt-hook] [@prompt-tagger]. |
| `session_id` | `text NOT NULL` [@prompt-migration] | `sessionId: text('session_id').notNull()` [@schema] | Trimmed nonblank agent session ID [@prompt-hook] [@prompt-tagger]. |
| `prompt_id` | `text NOT NULL` [@prompt-migration] | `promptId: text('prompt_id').notNull()` [@schema] | Provider prompt key or generated UUID when missing [@prompt-hook] [@prompt-tagger]. |
| `prompt_text` | `text NOT NULL` [@prompt-migration] | `promptText: text('prompt_text').notNull()` [@schema] | Submitted prompt text; blank text is rejected [@prompt-tagger]. |
| `previous_agent_output` | `text` added by `20260723191552_capture-previous-agent-output` [@previous-output-migration] | `previousAgentOutput: text('previous_agent_output')` [@schema] | Optional latest assistant output read from hook `transcript_path`; blank output is stored as `null` [@prompt-hook] [@prompt-tagger]. |
| `repository` | `text NOT NULL` [@prompt-migration] | `text('repository').notNull()` [@schema] | Normalized repository key [@prompt-tagger]. |
| `branch` | `text NOT NULL` [@prompt-migration] | `text('branch').notNull()` [@schema] | Normalized branch name [@prompt-tagger]. |
| `submitted_at` | `text NOT NULL` [@prompt-migration] | `submittedAt: text('submitted_at').notNull()` [@schema] | ISO submission timestamp [@prompt-tagger]. |
| `reconciled_at` | `text` [@prompt-migration] | `reconciledAt: text('reconciled_at')` [@schema] | ISO stop/reconciliation timestamp or `null` [@prompt-tagger]. |

## Keys And Indexes

| Object | Definition | Helper Use |
| --- | --- | --- |
| `prompt_branches_pk` | Primary key on `source`, `session_id`, and `prompt_id` [@prompt-migration] | Conflict target for `recordPromptBranch()` [@prompt-tagger]. |
| `idx_prompt_branches_repository_branch` | Non-unique index on `repository`, `branch` [@prompt-migration] | Matches `promptsForBranch(repository, branch)` filters [@prompt-tagger]. |
| `idx_prompt_branches_session` | Non-unique index on `source`, `session_id`, `submitted_at` [@prompt-migration] | Matches session prompt lookup and ordering [@prompt-tagger]. |

## Hook Field Mapping

| Source | Session Field | Prompt Field | Submit Events |
| --- | --- | --- | --- |
| `claude-code` | `session_id` | `prompt_id` | `UserPromptSubmit` [@prompt-hook]. |
| `codex` | `session_id` | `turn_id` | `UserPromptSubmit` [@prompt-hook]. |
| `cursor` | `conversation_id` or `session_id` | `generation_id` | `beforeSubmitPrompt` [@prompt-hook]. |

The hook normalizer also accepts `Stop` as reconciliation, uses `cwd` when present, falls back to the first `workspace_roots` entry, and then falls back to the process working directory [@prompt-hook].

## Helper Contracts

`recordPromptBranch(input)` records a submitted prompt and returns the stored row.
Replaying the same source/session/prompt ID updates prompt text, keeps the earliest submission time, and preserves the first non-null previous agent output [@prompt-tagger] [@prompt-tests].

`reconcilePromptBranch(input)` updates a submitted prompt to the branch active after the agent turn.
If the input omits a prompt ID, it reconciles the latest unreconciled prompt for the same source/session pair [@prompt-tagger] [@prompt-tests].

`promptsForSession(source, sessionId)` returns prompts ordered by `submittedAt` and `promptId` [@prompt-tagger]. `promptsForBranch(repository, branch)` normalizes repository and branch input, then returns branch prompts ordered by submission time, source, session ID, and prompt ID [@prompt-tagger].
