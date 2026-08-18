---
title: "Use Prompt Capture"
summary: "Use prompt capture explains how runtime, hook, and skill code should store, query, and delete Rudder's local prompt records."
topics: [guides, runtime, prompt-capture, prompt-history, database]
sources:
  - id: db-client
    type: file
    path: src/db/client.ts
  - id: prompt-hook
    type: file
    path: src/prompt-hook.ts
  - id: prompt-tagger
    type: file
    path: src/prompt-tagger.ts
  - id: transcript
    type: file
    path: src/transcript.ts
  - id: hook-bin
    type: file
    path: bin/rudder-prompt-hook.ts
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
  - id: data-script
    type: file
    path: skills/rudder/scripts/manage-data.mjs
  - id: hook-tests
    type: file
    path: test/prompt-hook.test.ts
  - id: skill-tests
    type: file
    path: test/skill-runtime.test.ts
---

# Use Prompt Capture

Use prompt capture when hook or skill code needs local prompt text for the active repository branch.
The runtime stores prompt rows in `prompt_branches`, the plugin hook records submit and stop events, and the Rudder skill reads branch prompts through its context helper before resolving the approved local spec for test generation [@prompt-hook] [@prompt-tagger] [@context-script] [@skill].
The architecture is explained in [Prompt Branch Store](../../architecture/runtime/prompt-branch-store), exact prompt fields are listed in [Prompt Branches Schema](../../reference/database/prompt-branches-schema), and local spec persistence is covered by [Local Spec Store](../../architecture/runtime/local-spec-store).

## Set Runtime State First

Set `RUDDER_HOME` before the first database-backed helper call when a process needs isolated state. `rudderHome()` reads `RUDDER_HOME` or falls back to `~/.rudder`, and `dbPath()` appends `rudder.db` under that root [@db-client]. `openDb()` caches SQLite and Drizzle handles, so changing `RUDDER_HOME` after opening the database does not move the already-open handle [@db-client].

Installed plugin hooks also need the migration folder that ships inside the package.
`bin/rudder-prompt-hook.ts` detects `PLUGIN_ROOT` or `CLAUDE_PLUGIN_ROOT` and sets `RUDDER_MIGRATIONS_PATH` to `<plugin-root>/dist/drizzle` before parsing hook input [@hook-bin].
Source-side and test code can rely on the default migration folder when it runs from the repository [@db-client].

## Record Hook Events

Use `recordPromptHookEvent(source, payload, fallbackCwd?)` for provider hook payloads.
The helper supports `claude-code`, `codex`, and `cursor` sources, maps submit events to `recordPromptBranch()`, and maps `Stop` to `reconcilePromptBranch()` [@prompt-hook].
Submit payloads may include `transcript_path`; when present, Rudder reads the latest assistant text from the transcript and stores it as `previous_agent_output` if the transcript contains visible assistant output [@prompt-hook] [@transcript].

Use the executable path for plugin hook commands.
`bin/rudder-prompt-hook.ts` reads JSON from stdin, infers the source from `PLUGIN_ROOT` or `CLAUDE_PLUGIN_ROOT` when a plugin host provides either variable, otherwise requires `--source <claude-code|codex|cursor>`, and closes the database handle in `finally` [@hook-bin].
Tests enforce that both direct execution and plugin-host execution produce no stdout and ignore unavailable Git context without failing the host process [@hook-tests].

## Query Branch Intent

Use `promptsForSession(source, sessionId)` when starting from a known agent session, and use `promptsForBranch(repository, branch)` when the skill needs all prompt intent associated with a repository branch [@prompt-tagger].
`skills/rudder/scripts/context.mjs` resolves the current repository, branch, base ref, merge base, tracked and untracked changes, test-path candidates, spec candidates, changed test-line counts, prompt records, and optional local spec record for that repository/branch, then prints one JSON object for the skill to inspect [@context-script].
Each prompt object includes exact text, optional previous agent output, identifiers, and submission and reconciliation timestamps [@context-script].

Start a run with `--phase start`; retain its generated `rudderRunId` and resolved `baseRef`, then use both on `--phase refresh` calls after follow-up answers and before reporting [@context-script] [@skill].
The skill treats helper classifications as candidates and requires the agent to inspect the returned merge base, changed paths, captured prompts, local spec record, spec candidates, repository instructions, production diff, existing tests, and native test/coverage configuration before deciding what to reset or generate [@skill].

## Respect Data Controls

The `manage-data.mjs` helper reports `rudderHome`, `databasePath`, and `promptCount`; it deletes prompt rows only when invoked as `delete --confirm` [@data-script].
It no longer accepts `disable` or `enable`, and the skill-runtime tests assert that `manage-data.mjs disable` fails with the usage contract [@skill-tests].

Deletion is intentionally scoped to prompt records.
`manage-data.mjs delete --confirm` counts rows in `prompt_branches`, enables SQLite secure deletion, deletes rows, truncates WAL, vacuums the database, and returns the remaining status [@data-script].
The skill-runtime tests enforce that an unconfirmed delete fails and confirmed deletion removes prompt records [@skill-tests].
