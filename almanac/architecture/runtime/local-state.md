---
title: "Local State"
summary: "Rudder keeps runtime state in a user-scoped home directory that owns the SQLite database, local spec files, telemetry identity, update-check cache, backups, and exported port defaults."
topics: [architecture, runtime, local-state, sqlite, prompt-capture, local-spec]
sources:
  - id: db-client
    type: file
    path: src/db/client.ts
  - id: telemetry
    type: file
    path: src/telemetry.ts
  - id: update-script
    type: file
    path: skills/rudder/scripts/update.mjs
  - id: backup-script
    type: file
    path: skills/rudder/scripts/backup-tests.mjs
  - id: local-spec-script
    type: file
    path: skills/rudder/scripts/local-spec.mjs
  - id: gitignore
    type: file
    path: .gitignore
---

Rudder local state is the small persistent runtime surface that exists outside the source tree.
The database client resolves a Rudder home directory from `RUDDER_HOME` or `~/.rudder`, stores the SQLite database at `rudder.db`, opens that database through a process-wide singleton, enables WAL journaling, applies generated Drizzle migrations, and then exposes Drizzle access [@db-client].
The same home directory stores device-local spec files, the anonymous telemetry identity file, the update-check cache, and skill-created test-reset backups, so [Prompt Branch Store](prompt-branch-store), [Local Spec Store](local-spec-store), [Telemetry](telemetry), and the skill runtime share one local state root [@local-spec-script] [@telemetry] [@update-script] [@backup-script].
Runtime artifacts live under the selected Rudder home instead of a repository-local state directory, while the source tree keeps only the code and configuration that derive those paths [@db-client] [@gitignore].

## State Root

`rudderHome()` is the owner of the local state path.
It returns `process.env.RUDDER_HOME` when that value is present, and otherwise joins the operating-system home directory with `.rudder` [@db-client].
`dbPath()` derives the database location by joining that root with `rudder.db` [@db-client].
The local spec helper derives `<rudderHome()>/specs/`, the update helper derives `<rudderHome()>/update-state.json`, and the backup helper writes test-reset backups under `<rudderHome()>/backups/` [@local-spec-script] [@update-script] [@backup-script].

The source tree does not carry a repo-local state directory convention.
The repository ignore file covers dependencies, build output, generated backups, logs, environment files, coverage, and editor files, but it does not define a `.rudder/` workspace cache [@gitignore].
The runtime code instead creates the selected Rudder home directory directly, so changing the state location is an environment-variable choice rather than a working-tree layout change [@db-client].
The local spec helper also rejects a Rudder state root that would place local specs inside the repository [@local-spec-script].

## Database Open Flow

`openDb()` is the entrypoint that turns the path contract into a live SQLite connection.
It returns the existing `_sqlite` handle when one has already been opened, creates the Rudder home directory recursively on the first open, restricts the state directory to mode `0700` when possible, constructs `DatabaseSync` at `dbPath()`, restricts the database file to mode `0600` when possible, enables `PRAGMA journal_mode = WAL`, sets `PRAGMA busy_timeout = 5000`, enables `PRAGMA secure_delete = ON`, initializes Drizzle, and applies migrations from the configured `drizzle/` folder [@db-client].
The singleton matters because the Drizzle wrapper and the raw SQLite handle are initialized together and reused through module-level state [@db-client].

Migration application is deliberately part of the open flow.
`openDb()` derives the migration directory from `RUDDER_MIGRATIONS_PATH` when that variable is set, otherwise it resolves the repository `drizzle/` directory relative to `src/db/client.ts`; it closes the raw SQLite handle if migration application fails [@db-client].
That means code using the [Prompt Branch Store](prompt-branch-store) can call `rudderDb()` without running a separate migration command first; `rudderDb()` opens the database if the Drizzle singleton is still missing [@db-client].

## Port Helper

`rudderPort()` is a small exported local-state helper for a future or host-owned port consumer.
It converts `RUDDER_PORT` with `Number()`, accepts only integer ports greater than zero and less than `65536`, and falls back to `41789` for unset, non-numeric, fractional, zero, negative, or out-of-range values [@db-client].
The exact environment contract is listed in [Environment Variables](../../reference/configuration/environment-variables).

## Shared Boundary

Local state currently covers the SQLite database path, device-local spec files, the telemetry identity file, the update-check cache, skill backup directories, and the exported port default.
Telemetry builds `identity.json` under `rudderHome()`, preserves an existing anonymous UUID, and adds a random local-only pseudonymization key when either field is missing [@telemetry].
It creates the state root with mode `0700`, writes the identity file with mode `0600`, reapplies those permissions when an existing complete identity is loaded, and treats all persistence and permission changes as best-effort [@telemetry].
The local spec helper stores copied or generated specs under `specs/` with mode `0700` on the directory and `0600` on the spec files when supported, while the update helper writes `update-state.json` atomically through a temporary file with mode `0600` after creating the Rudder home with mode `0700` [@local-spec-script] [@update-script].
The important invariant is that runtime code should derive persistent paths from `rudderHome()` instead of inventing new repository-local locations.
That keeps [Telemetry](telemetry), [Prompt Branch Store](prompt-branch-store), [Local Spec Store](local-spec-store), the update helper, and the environment-variable reference aligned around the same state root [@db-client] [@telemetry] [@local-spec-script] [@update-script].
