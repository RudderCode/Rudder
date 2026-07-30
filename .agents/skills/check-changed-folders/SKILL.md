---
name: check-changed-folders
description: Run typecheck, tests, and builds for Rudder's core and plugin workspaces on the current branch versus main, verify Claude/Codex provider parity, verify the centralized agent-instruction layout, and verify agent attribution. Use when asked to run "/check", to validate a branch before commit/PR, whenever a user asks to run checks before publishing, or whenever changes affect provider-facing plugin surfaces such as manifests, hooks, skills, MCP servers, apps, or UI.
---

# Check Changed Folders

Identify what changed on the branch, verify provider parity, the centralized agent-instruction layout, and agent attribution, run the package checks, and report pass/fail status with actionable failure output.
The root npm scripts validate the core package and the Rudder plugin workspace.
Checks are therefore repo-wide rather than per-package.

## Workflow

1. Identify changed files against `main`, including local staged/unstaged changes:

```bash
git fetch origin main
git diff --name-only origin/main...HEAD
git diff --name-only
git diff --name-only --cached
```

   If anything under `src/`, `bin/`, `test/`, `ui/`, `.claude-plugin/`, `.codex-plugin/`, `hooks/`, `skills/`, or a build/config file (`package.json`, `tsconfig*.json`, `.mcp.json`, `.github/`) changed, the package checks below apply.

2. Verify the centralized agent-instruction layout before running checks:

- `AGENTS.md` is the canonical repository guidance.
- `.agents/skills/` is the only reusable-workflow source.
  Do not add command aliases or edit tool-specific symlinks.
- Ensure that every skill has a corresponding `skills/<skill-name>/agents/openai.yaml` detailing its Codex display name, short description, and default prompt.
- Confirm the compatibility links resolve correctly:
  - `.claude/skills` -> `../.agents/skills`
  - `.codex/skills` -> `../.agents/skills`
- If any link is missing or resolves outside `.agents/`, mark the check as failed and report the broken path.

3. Verify provider parity.

- Treat Claude and Codex as supported providers for the same Rudder plugin package.
- When a change adds, removes, or modifies a provider-facing component—manifest metadata, skills, hooks, MCP servers, apps, UI, or packaged artifacts—inspect both provider manifests and runtime paths.
- Require equivalent discovery, launch behavior, packaged resources, and user-facing capability across providers.
  Provider-specific schema or environment-variable differences are allowed, but they must remain explicit implementation details rather than functional gaps.
- Add or update a regression assertion in `test/plugin-package.test.ts` or the relevant runtime test that exercises both provider paths.
  If provider-facing behavior changes without parity coverage, fail this check.
- Permit a provider-specific exception only when the user explicitly requests it or the provider cannot support the capability.
  Report the reason, the affected provider, and the test that protects the supported behavior.

4. Verify agent attribution.
   If a coding agent wrote code included in the
branch, inspect `git log origin/main..HEAD` and require every such agent to appear as a commit author or in a `Co-authored-by:` trailer.
Missing agent attribution on committed work fails the check.
If the agent-written work is still uncommitted, report attribution as pending and name the trailer that must be added when committing.
Human-only changes are not subject to this check.

5. Install dependencies if `node_modules/` does not exist: run `npm install`.

6. Run the package checks (the same set `prepublishOnly` runs, so green means publishable):

```bash
npm run typecheck
npm test
npm run build
```

7. Surface and address open PR comments.
   If the current branch has an open GitHub PR, always invoke the `address-pr-comments` skill before finishing.
   That skill fetches open review comments (Greptile, human reviewers) for the PR, dedupes them, and fixes/declines/defers each one.
   Only if `gh` is unavailable or there is no PR for the current branch, treat this step as `skipped`.
   If any comment is acted on, re-run the checks before reporting.

8. Report concise results:

- State whether typecheck, tests, and build passed, failed, or were skipped.
- Include dedicated results for provider parity, agent-instruction layout, agent attribution, and PR comments (`passed`, `failed`, `pending`, or `skipped`) and why.
- For failures, include the key error output and which command failed.
- Distinguish real failures (provider drift, missing parity coverage, broken agent links, missing agent attribution, type errors, test failures, unaddressed P0/P1 PR comments) from environment issues (missing CLI tools, no PR).

## Notes

- Default comparison branch is `origin/main` (not local `main`, which may be stale).
- Provider parity means equivalent behavior and coverage, not necessarily byte-identical provider configuration.
- The `.agents/` layout is a required gate, not an optional reminder.
- Agent attribution is required only when an agent contributed code.
- If nothing relevant changed, state that no checks were required.
