---
title: "Specs Schema"
summary: "The specs schema reference defines Rudder's branch-to-local-spec mapping table, migration contract, and helper read/write behavior."
topics: [reference, database, local-spec, runtime, sqlite]
sources:
  - id: schema
    type: file
    path: src/db/schema.ts
  - id: specs-migration
    type: file
    path: drizzle/20260818210137_add-local-specs/migration.sql
  - id: db-client
    type: file
    path: src/db/client.ts
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
  - id: local-spec-script
    type: file
    path: skills/rudder/scripts/local-spec.mjs
  - id: migrations-test
    type: file
    path: test/migrations.test.ts
  - id: local-spec-tests
    type: file
    path: test/local-spec.test.ts
---

# Specs Schema

The `specs` table is Rudder's SQLite mapping from an active repository branch to its approved device-local spec file.
Drizzle declares the table in `src/db/schema.ts`, the `20260818210137_add-local-specs` migration creates it, `context.mjs` reads it into the skill context, and `local-spec.mjs` creates or refreshes the corresponding file outside the repository [@schema] [@specs-migration] [@context-script] [@local-spec-script].
This reference is the exact lookup companion to [Local Spec Store](../../architecture/runtime/local-spec-store) and [Prompt Branches Schema](prompt-branches-schema).

## Runtime Creation

`openDb()` applies committed Drizzle migrations before exposing the cached SQLite and Drizzle handles, so a migrated Rudder database contains the spec mapping without a separate setup command [@db-client].
The migration test opens a new database, asserts that `prompt_branches` and `specs` are the live Rudder tables from the checked set, verifies the `specs` columns, checks that `(repository, branch)` rejects duplicate inserts, and expects four applied migrations [@migrations-test].

## Columns

| Column | SQLite Migration | Drizzle Declaration | Helper Field |
| --- | --- | --- | --- |
| `repository` | `text NOT NULL` [@specs-migration] | `text('repository').notNull()` [@schema] | Normalized repository key returned by `repositoryKey(root, branch)` [@context-script] [@local-spec-script]. |
| `branch` | `text NOT NULL` [@specs-migration] | `text('branch').notNull()` [@schema] | Attached Git branch name resolved from the repository [@context-script] [@local-spec-script]. |
| `spec_path` | `text NOT NULL` [@specs-migration] | `specPath: text('spec_path').notNull()` [@schema] | Absolute local Markdown path returned to the skill as `localSpec.specPath` [@context-script] [@local-spec-script]. |
| `source_relative_path` | `text` [@specs-migration] | `sourceRelativePath: text('source_relative_path')` [@schema] | Repository-relative source file path for imported specs, or `null` for generated local specs [@local-spec-script] [@local-spec-tests]. |

## Key

| Object | Definition | Helper Use |
| --- | --- | --- |
| `specs_pk` | Primary key on `repository` and `branch` [@specs-migration] | Prevents more than one local spec mapping for the same repository branch; duplicate `create` attempts fail [@local-spec-script] [@local-spec-tests]. |

## Helper Contracts

`context.mjs` reads the table only when the database and `specs` table exist; missing local state produces `localSpec: null` rather than failing the context command [@context-script] [@local-spec-tests].
The JSON record uses camelCase names: `repository`, `branch`, `specPath`, and `sourceRelativePath` [@context-script].

`local-spec.mjs create` writes one new mapping after copying either a repository-relative `--source` file or an external `--input` file into `<rudderHome()>/specs/` [@local-spec-script].
The helper requires the database to already exist and include the specs migration, rejects repository-local spec storage, rejects absolute or non-file repository sources, and refuses to create a second mapping for the same branch [@local-spec-script] [@local-spec-tests].

`local-spec.mjs replace-source` updates the local file from the recorded repository source without changing the source file [@local-spec-script] [@local-spec-tests].
It requires an existing mapping with `sourceRelativePath`, rejects missing or repository-local `specPath` values, and restores the previous local file if replacement fails during the database transaction [@local-spec-script].
