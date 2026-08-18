---
title: "BYOK Skill Workflow"
summary: "Rudder guides the user's current coding agent with a local skill workflow instead of making separate model calls itself."
topics: [decisions, product-intent]
sources:
  - id: product-readme
    type: file
    path: README.md
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
  - id: plugin-package
    type: file
    path: package.json
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
  - id: local-spec-script
    type: file
    path: skills/rudder/scripts/local-spec.mjs
  - id: backup-script
    type: file
    path: skills/rudder/scripts/backup-tests.mjs
  - id: telemetry-script
    type: file
    path: skills/rudder/scripts/telemetry.mjs
---

Rudder's BYOK skill workflow decision is that test generation and spec-backed production edits happen inside the user's existing coding-agent session, using that agent's configured model access and credentials, rather than through a separate Rudder-owned model call [@product-readme] [@skill].
The root plugin package ships the Rudder skill and deterministic helper scripts; the skill gathers local prompt intent, resolves an approved device-local spec, inspects the worktree, checks for plugin updates, confirms and backs up test resets, directs tagged red-green changes, coordinates bounded rewrite batches, measures coverage, and produces a spec-section report in the same session [@plugin-package] [@skill] [@local-spec-script].
This decision ties [intent-driven test generation](../../concepts/product/intent-driven-test-generation), [test intent standards](../../concepts/product/test-intent-standards), [prompt history](../../concepts/runtime/prompt-history), and [Local Spec Store](../../architecture/runtime/local-spec-store) into one local workflow.

## Status

Accepted and implemented as the current plugin workflow.
The README describes Rudder as a local plugin for Claude Code and Codex that uses the agent and model the user already has configured [@product-readme].
The current package implements the delivery mechanism as a local plugin skill with helper scripts for context gathering, local spec creation, and exact-path test backups, while the host agent owns reasoning, local spec amendments, test edits, and any smallest production change required by a spec-backed red-green cycle [@plugin-package] [@skill] [@context-script] [@local-spec-script] [@backup-script].

## Context

Rudder's workflow depends on intent that exists in the current coding session.
The README says Rudder generates tests from prompts, stores prompt data locally, and runs directly in the user's coding-agent session [@product-readme].
The skill turns that product model into a direct-intent contract: every generated expectation must trace to an approved local spec section with captured prompt provenance, and missing coverage must become one concrete question plus a local spec amendment before the next test is written [@skill].

A separate model call would move generation away from the session that produced the implementation.
The README instead places prompt reading, generated tests, coverage results, questions, and answers inside the current coding-agent session [@product-readme].

## Decision

Rudder is delivered to the user's coding agent as a skill plus deterministic local helper tools.
The skill defines the workflow rules for update notices, session intent, local spec resolution, test-path review, tagged generated tests, red-green implementation cycles, bounded rewrite ownership, native tooling, coverage measurement, follow-up questions, and final reports [@skill].
Local tools handle deterministic worktree, local spec storage, backup, prompt-data, plugin-update, and metadata-only measurement operations, while the user's current agent handles reasoning and generation [@skill] [@context-script] [@local-spec-script] [@backup-script] [@telemetry-script].

## Consequences

The decision keeps generation repository- and provider-agnostic.
The README says Rudder uses the repository's own test and coverage tools and keeps test generation with the coding agent and model the user already uses [@product-readme].
It also keeps every follow-up question in the session where the feature was implemented, so user answers become captured prompt records that can authorize local spec sections for later generation passes [@skill].
The host may use its own subagent facility for up to three isolated rewrite tasks, but the main agent still owns questions, intent interpretation, local spec amendments, integration, coverage, and reporting; no Rudder-owned model service enters the loop [@skill].

The implemented helper layer can supply branch changes, exact prompt records including prior agent output, local spec mappings, update commands, recoverable backups, and best-effort run measurements, but it does not determine behavioral intent or generate tests [@context-script] [@local-spec-script] [@backup-script] [@telemetry-script] [@skill].
The tradeoff is that the local workflow must express spec amendments, batching, provenance, and failure boundaries clearly enough for supported coding agents to execute.
Future product work should preserve this boundary unless a later decision explicitly moves model selection or generation into Rudder itself.
