---
title: "Rudder Plugin Package"
summary: "The root npm package distributes Rudder as one Claude Code and Codex plugin with manifests, hooks, skill files, docs, assets, a prompt-capture and telemetry runtime, and an MCP App runtime."
topics: [architecture, tooling, package, plugin, prompt-capture, mcp-app, release]
sources:
  - id: package-json
    type: file
    path: package.json
  - id: claude-manifest
    type: file
    path: .claude-plugin/plugin.json
  - id: codex-manifest
    type: file
    path: .codex-plugin/plugin.json
  - id: marketplace
    type: file
    path: .claude-plugin/marketplace.json
  - id: hooks
    type: file
    path: hooks/hooks.json
  - id: hook-bin
    type: file
    path: bin/rudder-prompt-hook.ts
  - id: mcp-config
    type: file
    path: .mcp.json
  - id: mcp-bin
    type: file
    path: bin/rudder-mcp-server.ts
  - id: mcp-runner
    type: file
    path: src/mcp/run-server.ts
  - id: mcp-server
    type: file
    path: src/mcp/server.ts
  - id: app-builder
    type: file
    path: scripts/build-mcp-app.mjs
  - id: app-source
    type: file
    path: ui/rudder-app.ts
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
  - id: skill-telemetry
    type: file
    path: skills/rudder/scripts/telemetry.mjs
  - id: rudder-telemetry
    type: file
    path: src/rudder-telemetry.ts
  - id: plugin-tests
    type: file
    path: test/plugin-package.test.ts
  - id: mcp-tests
    type: file
    path: test/mcp-server.test.ts
  - id: ui-tests
    type: file
    path: test/ui.test.ts
  - id: install-doc
    type: file
    path: docs/install.md
  - id: publish-workflow
    type: file
    path: .github/workflows/publish.yml
---

# Rudder Plugin Package

The repository root is the publishable Rudder plugin package. `package.json` names the package `@ruddercode/rudder-plugin`, requires Node `>=24.0.0`, and includes plugin-specific artifacts such as `.mcp.json`, `.claude-plugin`, `.codex-plugin`, `assets`, `docs`, `hooks`, `skills`, and `dist` in the npm file allowlist [@package-json]. The package carries both Claude Code and Codex plugin manifests, a public marketplace catalog that points at the npm package, the Rudder skill and helper scripts, one bundled runtime used for prompt capture and bounded product telemetry, and the MCP App runtime that opens Rudder's interactive UI [@claude-manifest] [@codex-manifest] [@marketplace] [@hooks] [@skill] [@skill-telemetry] [@rudder-telemetry] [@mcp-config] [@mcp-server].

## Distribution Shape

The Claude manifest and Codex manifest share the public plugin name `rudder`, version, description, license, repository, keywords, `./skills/` path, and `./.mcp.json` MCP server configuration path [@claude-manifest] [@codex-manifest]. The Claude manifest also points at `./hooks/hooks.json`, while the Codex manifest carries interface metadata such as display name, short description, category, default prompt, icon, logo, privacy URL, terms URL, and the `Interactive` capability [@claude-manifest] [@codex-manifest]. Package tests enforce that the two manifests keep matching `skills` and `mcpServers` fields, that Codex declares `Interactive`, and that `.mcp.json` is included in the npm file allowlist [@plugin-tests].

The marketplace catalog under `.claude-plugin/marketplace.json` lists one plugin named `rudder` and resolves it from npm package `@ruddercode/rudder-plugin` on the public npm registry [@marketplace]. Tests enforce that the package version is synchronized across `package.json`, `package-lock.json`, both plugin manifests, and both marketplace version fields [@plugin-tests]. The install docs describe Claude Code and Codex marketplace installation separately but state that both use the same npm-backed plugin package [@install-doc].

## Bundled Hook

`hooks/hooks.json` registers command hooks for `UserPromptSubmit` and `Stop` [@hooks]. Each command executes Node with `--input-type=module`, resolves the plugin root from `PLUGIN_ROOT` or `CLAUDE_PLUGIN_ROOT`, and imports `dist/rudder-prompt-hook.mjs` from that root [@hooks]. In ordinary hook mode, the source executable reads JSON from stdin, infers Codex from `PLUGIN_ROOT` or Claude Code from `CLAUDE_PLUGIN_ROOT`, sets `RUDDER_MIGRATIONS_PATH` to the installed `dist/drizzle` folder, and records the prompt lifecycle event [@hook-bin].

The same executable has an internal `--rudder-event` mode for the five validated events in `src/rudder-telemetry.ts` [@hook-bin] [@rudder-telemetry]. `skills/rudder/scripts/telemetry.mjs` launches that bundled artifact as a detached best-effort child for run, context, backup, question, and completion metadata without exposing PostHog to the skill process [@skill-telemetry]. Both modes catch top-level failures, report exceptions best-effort, close any database handle, shut down telemetry, and avoid model-visible output [@hook-bin].

The `build` script creates the installed runtime artifacts by bundling `bin/rudder-prompt-hook.ts` and `bin/rudder-mcp-server.ts` with esbuild for Node ESM output, building the MCP App resource, and then copying committed Drizzle migrations into `dist/drizzle` [@package-json]. `pretest`, `test:coverage`, and `prepack` build before their downstream work, so tests, coverage, and packed artifacts use fresh package output [@package-json]. Plugin package tests enforce matching Claude/Codex metadata, required package file entries including the skill telemetry helper and MCP configuration, marketplace npm source fields, hook command shape, and silent prompt-hook execution for both `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` environments [@plugin-tests].

## MCP App Runtime

The MCP App path uses the same host-neutral plugin-root pattern as the prompt hook. Both plugin manifests point to `./.mcp.json`; that file defines one `rudder` MCP server launched with `node --input-type=module -e` from `cwd: "."` [@claude-manifest] [@codex-manifest] [@mcp-config]. The inline launcher resolves the installed root from `PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`, or the current working directory, then imports `dist/rudder-mcp-server.mjs` from that root [@mcp-config]. The bundled entrypoint calls `runRudderMcpServer()`, whose default transport is stdio, whose plugin-root resolver accepts either host root variable, and whose app loader reads `dist/rudder-app.html` from the installed package [@mcp-bin] [@mcp-runner].

`createRudderMcpServer` registers the app resource at `ui://rudder/workspace.html` and exposes a read-only `open_rudder` tool that points its `_meta.ui.resourceUri` at that resource [@mcp-server]. The tool returns structured launch content with a `ready` status, title, summary, and fallback text so clients without a visible app surface still receive a useful result [@mcp-server]. MCP server tests connect through an in-memory transport to assert the tool, resource URI, MIME type, inline app HTML, and structured result, then launch the packaged stdio server once with `PLUGIN_ROOT` and once with `CLAUDE_PLUGIN_ROOT` [@mcp-tests].

The browser app is packaged as a single HTML resource. `scripts/build-mcp-app.mjs` bundles `ui/rudder-app.ts` as a browser IIFE, escapes script and HTML-comment delimiters inside the generated script, replaces the `<script data-rudder-app></script>` marker in the HTML template, and writes `dist/rudder-app.html` [@app-builder]. The app source connects to the MCP Apps bridge, renders structured launch results into the `status`, `title`, `summary`, and `fallback` elements, and falls back to chat instructions when the host cannot provide the app bridge [@app-source]. UI tests cover structured-result rendering, absent or malformed result fallback, unavailable-host fallback, and missing-template-element failures [@ui-tests].

## Release Boundary

The publish workflow expects the root package name to be exactly `@ruddercode/rudder-plugin`, checks npmjs.org for the version, creates plugin tags in the `rudder-plugin-v<version>` form, and validates the package with agent layout, typecheck, 90% changed-line coverage, build, and `npm pack --dry-run` before publishing [@publish-workflow] [@package-json]. The release behavior is covered in [Release Automation](../release/release-automation), and the command surface is listed in [Package Scripts](../../reference/tooling/package-scripts).
