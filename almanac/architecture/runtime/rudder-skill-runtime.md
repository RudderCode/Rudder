---
title: "Rudder Skill Runtime"
summary: "The Rudder skill combines deterministic context, backup, update, data-control, and telemetry helpers with a prompt-backed TDD workflow, bounded rewrite batches, and per-prompt test reports."
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
  - id: telemetry-script
    type: file
    path: skills/rudder/scripts/telemetry.mjs
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

The Rudder skill runtime is the local helper layer behind the installed `$rudder` workflow. `skills/rudder/SKILL.md` tells the current coding agent to derive tests and minimal production changes from captured intent, coordinate bounded rewrite batches, and prepare a per-prompt test report, while executable scripts handle update checks, deterministic context, exact-path backups, prompt-data deletion, and metadata-only run telemetry [@skill] [@update-script] [@context-script] [@backup-script] [@data-script] [@telemetry-script]. This preserves the [BYOK Skill Workflow](../../decisions/product/byok-skill-workflow): the user's current agent owns behavioral judgment and code changes, while local scripts do repeatable filesystem, Git, SQLite, update, measurement, and dispatch work [@skill].

## Update Helper

`scripts/update.mjs` is the skill's best-effort plugin update helper. The skill runs `scripts/update.mjs check` once at the start of each test-generation invocation and continues even when the check is unavailable [@skill]. The helper reads the installed package version, queries the npm registry for the latest `@ruddercode/rudder-plugin` version with a 1500 ms timeout, caches successful checks in `<rudderHome()>/update-state.json` for 24 hours, and returns stale cached data or an unavailable result when registry lookup fails [@update-script].

When a user accepts an update notice, the skill runs `scripts/update.mjs apply --host <codex|claude-code>` [@skill]. The helper plans Codex updates with `codex plugin marketplace upgrade rudder --json` followed by `codex plugin add rudder@rudder --json`; Claude Code updates use `claude plugin marketplace update rudder` followed by `claude plugin update rudder@rudder` [@update-script]. Each update command is retried three times, and a failed update is reported without blocking the active Rudder flow [@update-script] [@skill-tests].

## Context Helper

`scripts/context.mjs` resolves the repository root from `--cwd`, requires an attached Git branch, chooses a base ref from `--base` or common `origin/main` and `master` fallbacks, calculates the merge base, and returns changed tracked and untracked paths as JSON [@context-script]. It classifies likely test paths using directory and filename conventions, leaves all other changed paths in `otherPaths`, counts changed test lines from the merge base, normalizes the repository key from the active branch remote or a hashed local Git common directory, and reads matching prompts from `prompt_branches` in the local Rudder database when that table exists [@context-script]. Prompt objects include identifiers, exact prompt text, previous agent output, submission time, and reconciliation time [@context-script].

The first call uses `--phase start`, creates a UUID `rudderRunId`, and returns the resolved `baseRef`; later calls use `--phase refresh` with that same run ID and base [@context-script] [@skill]. Both phases best-effort dispatch bounded run/context telemetry without changing the JSON contract or waiting for delivery [@context-script]. The skill treats the returned classifications as input rather than final judgment and requires the agent to inspect repository instructions, diffs, tests, prompts, and native tooling before deciding which test changes matter [@skill].

## Backup Helper And Test Reset

`scripts/backup-tests.mjs` creates recoverable backups for explicit test paths before any reset. It requires `--cwd` and the active `--run-id`, verifies the base ref, computes the merge base, requires at least one `--path`, normalizes each path to stay inside the repository, writes a binary-capable patch for tracked changes, copies listed untracked paths into the backup directory, and emits backup metadata as JSON [@backup-script]. Only after the recovery metadata exists does it best-effort record approved and copied path counts for that run [@backup-script] [@telemetry-script].

The skill boundary is stricter than the helper's write behavior. The skill requires the agent to show the exact tracked and untracked test paths, inspect confirmed paths for immediately preceding Rudder source-intent tags, get explicit confirmation, run the backup helper for only those paths, verify the reported patch and untracked copies, and then restore only the confirmed test paths to the merge-base state [@skill]. After the reset, the agent attempts to restore only recorded tagged test cases plus the smallest required imports, fixtures, or helpers; untagged tests and whole-file restoration stay in the backup unless they can be isolated safely [@skill].

## Prompt-Backed TDD

The skill now treats coverage as loop control rather than a source of test intent. It can generate or expand a test only when a captured user prompt or answer explicitly requires the expectation, and after the first green suite it must ask one concrete question for an uncovered behavior before writing more tests [@skill]. Each generated or rewritten test case gets a language-appropriate source-intent comment immediately above the test case in `<source>/<sessionId>/<promptId>` form, using identifiers returned by `scripts/context.mjs` [@skill].

Production edits are allowed only inside a red-green cycle backed by captured intent. For each new or changed expectation, the skill writes the tagged test first, runs the narrowest test to observe the expected failure, makes the smallest production change required to satisfy that expectation, reruns the narrow test, and measures coverage only after the suite is green [@skill].

## Bounded Rewrite Batches

The main agent is the only participant allowed to ask the user questions and remains responsible for intent interpretation, queue ownership, integration, and coverage [@skill]. After a captured answer authorizes an expectation, the main agent may dispatch a bounded rewrite task to a subagent with the exact source tag, disjoint test and production paths, relevant repository instructions, and a narrow test command [@skill].

At most three rewrite subagents may run at once, and no more than three tasks may be dispatched between coverage measurements [@skill]. Each owns one red-green cycle and may not ask questions, spawn more agents, run coverage, commit, or edit outside its assigned paths [@skill]. The main agent must join the entire batch, inspect the combined diff and tags, repair invalid results serially, run related and full tests, and measure coverage only after the joined suite is green [@skill]. Conflicting ownership or hosts without subagent support fall back to serial execution [@skill].

## Run Telemetry

`scripts/telemetry.mjs` supplies two explicit CLI operations around the run identity returned by the context helper [@telemetry-script]. `question-asked` validates a positive question ordinal and dispatches no question or answer text; `complete` validates bounded completion, test, and coverage states, derives final changed-path and test-line counts from Git, counts recognized Rudder source-tag lines in changed test files, and records the total number of questions [@telemetry-script]. The skill invokes completion only after its final report is ready and sets statuses from observed results, but telemetry remains best-effort and cannot change the workflow outcome [@skill] [@telemetry-script].

The telemetry helper launches the bundled hook as a detached child and ignores missing bundles, serialization failures, spawn failures, and receiver delays [@telemetry-script]. [Telemetry Architecture](telemetry) documents the event schemas, pseudonymization, and opt-out boundary.

## Per-Prompt Test Report

Every normal or intentionally stopped test-generation run ends with a temporary Markdown report after all rewrites have joined and final test results are known [@skill]. The agent refreshes context, inspects final affected test paths, includes only test cases with an immediately preceding Rudder source tag, and matches each exact `<source>/<sessionId>/<promptId>` tag back to the captured prompt record instead of relying on memory or file proximity [@skill] [@context-script].

The report groups tests once per prompt, copies `promptText` exactly, represents `previousAgentOutput` concisely or as `N/A`, and links human-readable test titles to their repository-relative path and starting line when local links are supported [@skill]. It is written to a unique operating-system temporary file outside the worktree, is never staged, and uses an explicit no-tests message when no final prompt-backed tests exist [@skill]. A failure to create this report is a blocked run rather than a reason to omit the provenance handoff [@skill].

## Data Controls

`scripts/manage-data.mjs` is the skill's local data-control entrypoint. It reports `rudderHome`, `databasePath`, and prompt count, and deletes prompt rows only when invoked as `delete --confirm` [@data-script]. Confirmed deletion enables SQLite secure deletion, deletes rows from `prompt_branches`, truncates WAL, vacuums the database, and returns the resulting status [@data-script].

The skill handles data-control requests separately from test generation. It instructs the agent to use `manage-data.mjs` for status or delete requests, explain that confirmed deletion is irreversible, avoid deletion without an explicit request, and stop after completing the data-control task [@skill]. Tests assert that `disable` is no longer accepted by the data helper [@skill-tests].

## Validation Contract

`test/skill-runtime.test.ts` exercises the helper boundaries together: legacy capture-disable markers do not block prompt writes, the context helper returns run identity, changed test-line counts, prompt identifiers, text, and previous output, the update helper caches registry state and retries nonblocking updates, the backup helper backs up only explicit test paths, telemetry dispatch does not wait for an unresponsive receiver, question and completion commands return bounded JSON, and the data helper requires confirmation before deleting prompt rows [@skill-tests]. The OpenAI surface file gives Codex a display name, short description, and default prompt for the same skill package [@openai-surface].
