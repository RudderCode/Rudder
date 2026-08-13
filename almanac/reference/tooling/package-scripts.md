---
title: "Package Scripts Reference"
summary: "This reference documents Rudder's npm scripts and the automation paths that call them."
topics: [reference, tooling, package, mcp-app, validation]
sources:
  - id: package-json
    type: file
    path: package.json
  - id: mcp-config
    type: file
    path: .mcp.json
  - id: mcp-runner
    type: file
    path: src/mcp/run-server.ts
  - id: db-client
    type: file
    path: src/db/client.ts
  - id: test-workflow
    type: file
    path: .github/workflows/test.yml
  - id: publish-workflow
    type: file
    path: .github/workflows/publish.yml
  - id: check-skill
    type: file
    path: .agents/skills/check-changed-folders/SKILL.md
---

This reference lists the npm scripts defined by Rudder's package and the local or CI automation that reuses them. The scripts are the package-level command contract for typechecking, testing, changed-line coverage, building, database migration generation, and the prepublish gate [@package-json]. The [package baseline](../../architecture/tooling/package-baseline) explains how that contract fits the repository.

## Script Table

| Script | Command | Purpose |
| --- | --- | --- |
| `db:generate` | `drizzle-kit generate` | Runs Drizzle Kit's generate command [@package-json]. |
| `format:markdown` | `rumdl fmt` | Formats Markdown files [@package-json]. |
| `format:markdown:check` | `rumdl fmt --check` | Checks Markdown formatting without applying changes [@package-json]. |
| `danger:ci` | `danger ci --failOnErrors` | Runs Danger with failing errors for CI agent-guard enforcement [@package-json]. |
| `check:agent-layout` | `test -L .claude/skills && test -L .codex/skills && test .claude/skills -ef .agents/skills && test .codex/skills -ef .agents/skills && test ! -e .claude/commands && grep -Fxq '@AGENTS.md' CLAUDE.md` | Verifies Claude/Codex skill symlinks, absence of Claude command aliases, and the `CLAUDE.md` handoff [@package-json]. |
| `typecheck` | `tsc --noEmit` | Runs TypeScript checking without writing build output [@package-json]. |
| `build` | `rm -rf dist && esbuild bin/rudder-prompt-hook.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/rudder-prompt-hook.mjs && esbuild bin/rudder-mcp-server.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/rudder-mcp-server.mjs && node scripts/build-mcp-app.mjs && cp -R drizzle dist/drizzle` | Removes old `dist` output, bundles the prompt hook and MCP server for Node ESM, builds the single-file MCP App HTML resource, then copies generated Drizzle migrations into the package build tree [@package-json]. |
| `pretest` | `npm run build` | Rebuilds package artifacts before tests [@package-json]. |
| `test` | `node --test` | Runs Node's built-in test runner [@package-json]. |
| `test:coverage` | `npm run build && c8 node --test && diff-cover coverage/lcov.info --fail-under=90 --show-uncovered --include-untracked` | Builds first, runs the full Node suite under c8, writes LCOV, and fails when changed or untracked source lines are below 90% coverage [@package-json]. |
| `prepack` | `npm run build` | Rebuilds package artifacts before `npm pack` [@package-json]. |
| `prepublishOnly` | `npm run typecheck && npm test` | Runs typecheck and the test lifecycle before publishing; `npm test` invokes `pretest`, so the bundle is rebuilt before the test suite [@package-json]. |

## Automation Consumers

The Test workflow checks out full Git history, installs dependencies with `npm ci`, then runs `npm run check:agent-layout`, `npm run format:markdown:check`, `npm run typecheck`, `npm run test:coverage`, and `npm run build` in that order [@test-workflow]. Full history is required because `diff-cover` compares LCOV results with changed lines from Git [@test-workflow] [@package-json]. The local check skill remains the faster branch gate: it runs `npm run typecheck`, `npm test`, and `npm run build` after enforcing provider parity for provider-facing work, enforcing the centralized agent-instruction layout, verifying agent attribution, and installing dependencies when `node_modules/` is missing [@check-skill].

The c8 configuration measures `bin/**/*.ts`, `skills/**/*.mjs`, `src/**/*.ts`, and `ui/**/*.ts`, excludes `dist/**` and `test/**`, enables `all`, and emits the LCOV report consumed by `diff-cover` [@package-json]. `prepublishOnly` itself relies on the ordinary npm test lifecycle for the build, and `prepack` rebuilds again before packaging [@package-json]. The publish workflow separately runs `test:coverage` before packaging, so release automation enforces the changed-line threshold even though `npm publish`'s lifecycle hook uses `npm test` [@publish-workflow] [@package-json]. The `build` copy step is part of the database runtime contract because the installed prompt hook points `RUDDER_MIGRATIONS_PATH` at `dist/drizzle`; the decision is recorded in [Generated Drizzle Migrations](../../decisions/database/generated-drizzle-migrations) [@db-client]. The same build script is also part of the MCP App package contract because `.mcp.json` loads `dist/rudder-mcp-server.mjs`, and that server reads `dist/rudder-app.html` from the installed package [@package-json] [@mcp-config] [@mcp-runner]. The release workflow behavior is covered from the GitHub Actions side in the [GitHub Workflows](../automation/github-workflows) reference, release preparation is covered in [Prepare Package Release](../../guides/release/prepare-package-release), and the contributor-facing procedure is covered in [Run Checks](../../guides/contributor/run-checks).

## Change Surface

Changes to `typecheck`, `test`, or `build` affect local checks, CI, and package publication, while changes to `test:coverage` or the c8 configuration affect the CI and publish changed-line gate [@package-json] [@test-workflow] [@check-skill]. Provider-facing changes to manifests, hooks, skills, MCP servers, apps, UI, or packaged artifacts must also preserve Claude/Codex parity and parity coverage through the local check skill [@check-skill]. Changes to `build` can affect runtime prompt capture and Rudder usage telemetry if packaged output no longer includes `dist/rudder-prompt-hook.mjs` or `dist/drizzle`, and can affect MCP App startup if packaged output no longer includes `dist/rudder-mcp-server.mjs` or `dist/rudder-app.html` [@package-json] [@mcp-config]. Changes to `db:generate` affect migration-generation work and should be checked against the runtime migration decision [@package-json].
