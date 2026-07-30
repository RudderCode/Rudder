---
title: "Contributor Automation"
summary: "Contributor automation connects centralized agent skills, local check flows, PR-comment remediation, CI validation, and Danger-based agent guards into one guarded branch workflow."
topics: [architecture, automation, contributor-workflow, validation]
sources:
  - id: agents-readme
    type: file
    path: .agents/README.md
  - id: check-skill
    type: file
    path: .agents/skills/check-changed-folders/SKILL.md
  - id: comments-skill
    type: file
    path: .agents/skills/address-pr-comments/SKILL.md
  - id: release-skill
    type: file
    path: .agents/skills/prepare-package-release/SKILL.md
  - id: package
    type: file
    path: package.json
  - id: test-workflow
    type: file
    path: .github/workflows/test.yml
  - id: danger-workflow
    type: file
    path: .github/workflows/danger.yml
  - id: dangerfile
    type: file
    path: dangerfile.ts
---

Rudder's contributor automation is a set of local and CI gates for a repository that currently has one root plugin package and centralized agent workflows. `.agents/skills/` is the only reusable-workflow source, with `.claude/skills` and `.codex/skills` as compatibility symlinks [@agents-readme]. The `check-changed-folders` skill validates branches, verifies layout and attribution, runs local package checks, and delegates PR-comment remediation when a PR exists [@check-skill]. The `prepare-package-release` skill synchronizes package and plugin versions, ingests the complete range since the previous release, Gardens the whole CodeAlmanac wiki, and validates the prepared release [@release-skill]. GitHub Actions repeats package validation on branch pushes, while the Danger workflow enforces protected paths and inline agent guards for agent-authored pull requests [@test-workflow] [@danger-workflow] [@dangerfile].

## Local Check Surface

The check surface is centralized in `.agents/skills/check-changed-folders/SKILL.md` [@check-skill]. It starts by fetching `origin/main`, collecting changed files from the merge-base diff plus unstaged and staged local changes, and treating Rudder as repo-wide rather than per-package [@check-skill]. When files under `src/`, `bin/`, `test/`, package or TypeScript configuration, or `.github/` change, the package checks apply [@check-skill].

The centralized layout itself is a hard gate. The check skill requires `AGENTS.md` as canonical guidance, `.agents/skills/` as the only reusable workflow source, `skills/<skill-name>/agents/openai.yaml` metadata for shared skills, `.claude/skills` and `.codex/skills` symlinks to `.agents/skills`, and no `.claude/commands` aliases [@agents-readme] [@check-skill]. The [Run Checks](../../guides/contributor/run-checks) guide turns this architecture into the step-by-step contributor procedure.

Before package checks, the local flow also checks that each coding agent represented in committed work is listed as a commit author or `Co-authored-by` trailer. Agent-written uncommitted work is reported as pending attribution until it is committed; human-only changes are outside this gate [@check-skill].

## Package Checks

After layout and attribution checks, the local flow installs dependencies with `npm install` only when `node_modules/` is missing, then runs `npm run typecheck`, `npm test`, and `npm run build` [@check-skill]. The Test workflow adds the CI coverage boundary: it checks out full history, sets up Node 24, runs `npm ci`, checks agent layout and Markdown, typechecks, runs `npm run test:coverage` with a 90% changed-line threshold, and rebuilds on Ubuntu [@test-workflow] [@package]. The exact command meanings are listed in [Package Scripts](../../reference/tooling/package-scripts), while [GitHub Workflows](../../reference/automation/github-workflows) records CI triggers and permissions.

## PR Comment Remediation

The check flow delegates open PR feedback to a separate `address-pr-comments` skill [@check-skill]. That skill locates the current branch PR with `gh pr view`, fetches top-level issue comments and inline review comments through GitHub API endpoints, de-duplicates by path, line, author, and body hash, and ignores deploy-bot noise [@comments-skill]. Each remaining comment is verified against the current `HEAD`, then either fixed, declined with a reason, or deferred to the user when it needs a judgment call [@comments-skill].

That remediation flow has its own validation boundary. If it applies any fixes, it reruns `npm run typecheck`, `npm test`, and `npm run build`, but it does not invoke the full check flow again because that would re-enter the PR-comment workflow [@comments-skill]. The [Address PR Comments](../../guides/contributor/address-pr-comments) guide gives the operational procedure without duplicating the architecture here.

## Release Preparation

Release preparation has a dedicated workflow because one package version is repeated across the npm package, lockfile, Codex and Claude plugin manifests, and Claude marketplace metadata [@release-skill]. The skill treats `package.json` as authoritative, uses npm's no-tag version command, copies the exact result into every version-bearing manifest, and leaves tag creation to post-merge release automation [@release-skill].

The workflow finds the previous `rudder-plugin-v*` tag and uses the range from that tag through `HEAD` as Ingest's committed source boundary, alongside staged and unstaged changes [@release-skill]. This includes already-merged work that an `origin/main` branch diff would omit. Garden then reconciles the ingested release knowledge across the whole wiki [@release-skill]. Either job may validly produce no wiki changes when the release contains no durable knowledge. The prepared release is complete only after both the package checks and `codealmanac validate` pass [@release-skill]. The [Prepare Package Release](../../guides/release/prepare-package-release) guide provides the operational sequence.

## Agent Guards

`dangerfile.ts` protects `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `CLAUDE.md`, `docs/**`, `assets/**`, `.claude/**`, `.codex/**`, and `.cursor/**` from agent-authored pull request changes [@dangerfile]. It detects agent authorship from the PR author, commit author names and emails, and `Co-authored-by` trailers [@dangerfile]. The Danger workflow runs `npm run danger:ci` on pull requests to `main` after installing dependencies on Node 24 [@danger-workflow] [@package].

For detected-agent pull requests, Danger fails any changed path matching `PROTECTED_PATHS` and warns when the policy files `dangerfile.ts` or `.github/workflows/danger.yml` change [@dangerfile]. It also enforces inline `agent-guard:off` and `agent-guard:on` regions: invalid marker nesting fails, agent-authored changes inside protected regions fail, and marker changes warn for explicit review [@dangerfile]. The lookup version of this contract belongs in [Protected Paths](../../reference/contributor/protected-paths).
