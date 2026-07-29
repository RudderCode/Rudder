---
title: "Rudder Skill Runtime"
summary: "The Rudder skill uses local helper scripts for update checks, context gathering, exact-path test backups, and prompt-data deletion while the host coding agent follows the test-generation workflow."
topics: [architecture, runtime, plugin, prompt-capture, test-generation-intent]
sources:
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
  - id: backup-script
    type: file
    path: skills/rudder/scripts/backup-tests.mjs
  - id: data-script
    type: file
    path: skills/rudder/scripts/manage-data.mjs
  - id: update-script
    type: file
    path: skills/rudder/scripts/update.mjs
  - id: openai-surface
    type: file
    path: skills/rudder/agents/openai.yaml
  - id: skill-tests
    type: file
    path: test/skill-runtime.test.ts
---

# Rudder Skill Runtime

The Rudder skill runtime is the local helper layer behind the installed `$rudder` workflow. `skills/rudder/SKILL.md` tells the current coding agent to derive tests and minimal production changes from captured intent, while executable scripts handle update checks, deterministic context, exact-path backups, and prompt-data deletion [@skill] [@update-script] [@context-script] [@backup-script] [@data-script]. This preserves the [BYOK Skill Workflow](../../decisions/product/byok-skill-workflow): the user's current agent reasons about behavior and writes code, while local scripts do repeatable filesystem, Git, SQLite, and plugin-update work [@skill].

## Update Helper

`scripts/update.mjs` is the skill's best-effort plugin update helper. The skill runs `scripts/update.mjs check` once at the start of each test-generation invocation and continues even when the check is unavailable [@skill]. The helper reads the installed package version, queries the npm registry for the latest `@ruddercode/rudder-plugin` version with a 1500 ms timeout, caches successful checks in `<rudderHome()>/update-state.json` for 24 hours, and returns stale cached data or an unavailable result when registry lookup fails [@update-script].

When a user accepts an update notice, the skill runs `scripts/update.mjs apply --host <codex|claude-code>` [@skill]. The helper plans Codex updates with `codex plugin marketplace upgrade rudder --json` followed by `codex plugin add rudder@rudder --json`; Claude Code updates use `claude plugin marketplace update rudder` followed by `claude plugin update rudder@rudder` [@update-script]. Each update command is retried three times, and a failed update is reported without blocking the active Rudder flow [@update-script] [@skill-tests].

## Context Helper

`scripts/context.mjs` resolves the repository root from `--cwd`, requires an attached Git branch, chooses a base ref from `--base` or common `origin/main` and `master` fallbacks, calculates the merge base, and returns changed tracked and untracked paths as JSON [@context-script]. It classifies likely test paths using directory and filename conventions, leaves all other changed paths in `otherPaths`, normalizes the repository key from the active branch remote or a hashed local Git common directory, and reads matching prompts from `prompt_branches` in the local Rudder database when that table exists [@context-script]. The prompt objects returned to the skill include identifiers, prompt text, and timestamps; they do not currently include stored previous agent output [@context-script].

The skill treats this JSON as input, not as final judgment. It instructs the agent to inspect the merge base, changed paths, captured prompts, repository instructions, production diff, existing tests, and native test/coverage configuration before deciding which test changes matter [@skill].

## Backup Helper And Test Reset

`scripts/backup-tests.mjs` creates recoverable backups for explicit test paths before any reset. It requires `--cwd`, verifies the base ref, computes the merge base, requires at least one `--path`, normalizes each path to stay inside the repository, writes a binary-capable patch for tracked changes, copies listed untracked paths into the backup directory, and emits backup metadata as JSON [@backup-script].

The skill boundary is stricter than the helper's write behavior. The skill requires the agent to show the exact tracked and untracked test paths, inspect confirmed paths for immediately preceding Rudder source-intent tags, get explicit confirmation, run the backup helper for only those paths, verify the reported patch and untracked copies, and then restore only the confirmed test paths to the merge-base state [@skill]. After the reset, the agent attempts to restore only recorded tagged test cases plus the smallest required imports, fixtures, or helpers; untagged tests and whole-file restoration stay in the backup unless they can be isolated safely [@skill].

## Prompt-Backed TDD

The skill now treats coverage as loop control rather than a source of test intent. It can generate or expand a test only when a captured user prompt or answer explicitly requires the expectation, and after the first green suite it must ask one concrete question for an uncovered behavior before writing more tests [@skill]. Each generated or rewritten test case gets a language-appropriate source-intent comment immediately above the test case in `<source>/<sessionId>/<promptId>` form, using identifiers returned by `scripts/context.mjs` [@skill].

Production edits are allowed only inside a red-green cycle backed by captured intent. For each new or changed expectation, the skill writes the tagged test first, runs the narrowest test to observe the expected failure, makes the smallest production change required to satisfy that expectation, reruns the narrow test, and measures coverage only after the suite is green [@skill]. The package tests enforce that this prompt-backed production cycle replaced the older blanket instruction that generation must not change production code [@skill-tests].

## Data Controls

`scripts/manage-data.mjs` is the skill's local data-control entrypoint. It reports `rudderHome`, `databasePath`, and prompt count, and deletes prompt rows only when invoked as `delete --confirm` [@data-script]. Confirmed deletion enables SQLite secure deletion, deletes rows from `prompt_branches`, truncates WAL, vacuums the database, and returns the resulting status [@data-script].

The skill handles data-control requests separately from test generation. It instructs the agent to use `manage-data.mjs` for status or delete requests, explain that confirmed deletion is irreversible, avoid deletion without an explicit request, and stop after completing the data-control task [@skill]. Tests assert that `disable` is no longer accepted by the data helper [@skill-tests].

## Validation Contract

`test/skill-runtime.test.ts` exercises the helper boundaries together: legacy capture-disable markers do not block prompt writes, the context helper returns branch changes plus captured prompt identifiers and text, the update helper caches registry state and retries nonblocking updates, the backup helper backs up only explicit test paths, and the data helper requires confirmation before deleting prompt rows [@skill-tests]. The OpenAI surface file gives Codex a display name, short description, and default prompt for the same skill package [@openai-surface].
