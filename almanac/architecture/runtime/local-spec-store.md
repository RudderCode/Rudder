---
title: "Local Spec Store"
summary: "The local spec store maps each repository branch to one approved Markdown spec stored outside the worktree, and Rudder generates tests from that local copy instead of editing repository specs."
topics: [architecture, runtime, local-state, local-spec, database, product-intent]
sources:
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
  - id: telemetry-script
    type: file
    path: skills/rudder/scripts/telemetry.mjs
  - id: local-spec-script
    type: file
    path: skills/rudder/scripts/local-spec.mjs
  - id: data-script
    type: file
    path: skills/rudder/scripts/manage-data.mjs
  - id: spec-template
    type: file
    path: skills/rudder/references/spec-template.md
  - id: schema
    type: file
    path: src/db/schema.ts
  - id: specs-migration
    type: file
    path: drizzle/20260818210137_add-local-specs/migration.sql
  - id: local-spec-tests
    type: file
    path: test/local-spec.test.ts
  - id: migrations-test
    type: file
    path: test/migrations.test.ts
  - id: skill-tests
    type: file
    path: test/skill-runtime.test.ts
---

# Local Spec Store

The local spec store is Rudder's branch-scoped behavioral-spec contract.
The `specs` table maps one normalized repository and branch pair to an absolute Markdown file path, and `local-spec.mjs` stores that file under Rudder local state instead of the repository [@schema] [@specs-migration] [@local-spec-script].
The installed skill treats this approved device-local file as the source of truth for generated tests; repository specs can be copied in as read-only import sources, but the skill forbids editing, formatting, renaming, moving, or deleting repository specs [@skill].
This keeps [Intent-Driven Test Generation](../../concepts/product/intent-driven-test-generation) prompt-backed while making the approved local spec the stable behavior contract a run reads before writing tests.

## Branch Mapping

`src/db/schema.ts` exports `specs` beside `promptBranches`, and the generated migration creates `specs` with `repository`, `branch`, `spec_path`, and `source_relative_path` columns [@schema] [@specs-migration].
The primary key is `(repository, branch)`, so a branch has at most one active local spec record [@schema] [@specs-migration].
The migration test asserts that a new database contains both `prompt_branches` and `specs`, verifies the `specs` column nullability and key positions, checks the uniqueness constraint, and expects four applied Drizzle migrations [@migrations-test].
The exact table contract is listed in [Specs Schema](../../reference/database/specs-schema).

`scripts/context.mjs` is the read side.
It opens `<RUDDER_HOME or ~/.rudder>/rudder.db` read-only when the database exists, returns `localSpec` only when the `specs` table exists, and otherwise returns `localSpec: null` while still producing context JSON [@context-script].
The same context output has `schemaVersion: 2`, branch prompts, changed paths, test paths, production candidate paths, and `specCandidatePaths`, so the skill can resolve the spec before it resets or generates tests [@context-script] [@local-spec-tests].
Spec candidates are broad for Markdown-like specs and narrow for API schema files: `.feature`, `.md`, and `.mdx` paths qualify directly, while JSON and YAML paths qualify only when the file is named `openapi` or `asyncapi`, or when it is under an `openapi/` or `asyncapi/` path [@telemetry-script].
Candidate classification is independent from test and production classification, so a fixture Markdown file can appear in both `specCandidatePaths` and `testPaths`, while OpenAPI and AsyncAPI files can remain production candidates [@context-script] [@telemetry-script] [@local-spec-tests].

## Creating The Local Copy

`local-spec.mjs create` requires `--cwd`, `--run-id`, and exactly one of `--source` or `--input` [@local-spec-script].
A repository source must be repository-relative, resolve to a file inside the repository, and is copied byte-for-byte into the local state directory while recording `source_relative_path` [@local-spec-script] [@local-spec-tests].
An input file can initialize a generated local spec and records `source_relative_path` as `null` [@local-spec-script] [@local-spec-tests].

Local spec files are stored under `<rudderHome()>/specs/`, but the helper canonicalizes the future path and rejects a Rudder state root that would place specs inside the repository [@local-spec-script] [@local-spec-tests].
Creation requires an initialized, migrated Rudder database, refuses to overwrite an existing branch record, creates the specs directory with mode `0700` when supported, stages the file through a unique temporary path, and restricts the final file to mode `0600` when supported [@local-spec-script] [@local-spec-tests].

## Repository Spec Refresh

Repository specs remain import sources after the local copy exists.
When `context.mjs` returns a `localSpec` whose `sourceRelativePath` also appears in `specCandidatePaths`, the skill stops before amendments and asks whether to keep the local copy, merge the changed source into it, or replace it from the repository [@skill] [@context-script].
Keep and merge must not write to the repository source; replacement runs `local-spec.mjs replace-source`, which reads the recorded repository file and overwrites only the local spec copy [@skill] [@local-spec-script].

`replace-source` is intentionally narrow.
It fails when there is no local spec for the branch, when the local spec was generated without a repository source, when the stored absolute path is missing, and when the stored path is not valid local Rudder state outside the repository [@local-spec-script] [@local-spec-tests].
If replacement fails after staging the new content, the helper rolls back the database transaction and restores the original local file from a temporary copy [@local-spec-script].

## Data-Control Boundary

Prompt data controls do not manage local specs.
`manage-data.mjs status` reports `rudderHome`, `databasePath`, and `promptCount` only, while `delete --confirm` deletes rows from `prompt_branches` without exposing `specCount`, deleting `specs` rows, or removing files under `<rudderHome()>/specs/` [@data-script] [@skill-tests].
This preserves approved branch specs across prompt-history deletion, while repository source specs remain read-only files outside Rudder's data-control command [@skill] [@local-spec-script].

## Spec Shape And Test Tags

The local Markdown file is user-editable and canonical, and the skill rereads it before proposing, approving, or applying amendments [@skill].
Generated specs and amendments use the template sections `Summary`, `Scope`, `Affected Surfaces`, `Requirements`, and `Edge Cases`; only `REQ-NNN` and `EC-NNN` sections carry `Prompt provenance` entries with exact captured prompt identifiers [@skill] [@spec-template].
Worktree changes may identify affected surfaces and vocabulary, but they must not create behavioral requirements [@skill].

Generated or rewritten tests are authorized by spec sections, not by raw prompt records.
The skill may generate a test only when an approved local `REQ-NNN` or `EC-NNN` section explicitly requires the expectation and lists captured prompt provenance, then the test receives an adjacent `rudder-spec: <section-id>` tag [@skill].
The final report refreshes context, rereads the local spec, resolves each tag back to the current spec section, and omits tests whose section is missing, lacks prompt provenance, or cites prompt identifiers absent from refreshed captured records [@skill].
[Test Intent Standards](../../concepts/product/test-intent-standards) describes that generation boundary from the product side.
