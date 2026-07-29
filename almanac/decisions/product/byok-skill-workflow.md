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
  - id: backup-script
    type: file
    path: skills/rudder/scripts/backup-tests.mjs
---

Rudder's BYOK skill workflow decision is that test generation and prompt-backed production edits happen inside the user's existing coding-agent session, using that agent's configured model access and credentials, rather than through a separate Rudder-owned model call [@product-readme] [@skill]. The root plugin package ships the Rudder skill and deterministic helper scripts; the skill gathers local prompt intent, inspects the worktree, checks for plugin updates, confirms and backs up test resets, directs the agent through tagged tests and red-green implementation changes, runs repository tooling, measures coverage, and asks follow-up questions in the same session [@plugin-package] [@skill]. This decision ties [intent-driven test generation](../../concepts/product/intent-driven-test-generation), [test intent standards](../../concepts/product/test-intent-standards), and [prompt history](../../concepts/runtime/prompt-history) into one local workflow.

## Status

Accepted and implemented as the current plugin workflow. The README describes Rudder as a local plugin for Claude Code and Codex that uses the agent and model the user already has configured [@product-readme]. The current package implements the delivery mechanism as a local plugin skill with helper scripts for context gathering and exact-path test backups, while the host agent owns reasoning, test edits, and any smallest production change required by a prompt-backed red-green cycle [@plugin-package] [@skill] [@context-script] [@backup-script].

## Context

Rudder's workflow depends on intent that exists in the current coding session. The README says Rudder generates tests from prompts, stores prompt data locally, and runs directly in the user's coding-agent session [@product-readme]. The skill turns that product model into a direct-intent contract: every generated expectation must trace to a captured prompt record, and missing coverage must become one concrete question before the next test is written [@skill].

A separate model call would move generation away from the session that produced the implementation. The README instead places prompt reading, generated tests, coverage results, questions, and answers inside the current coding-agent session [@product-readme].

## Decision

Rudder is delivered to the user's coding agent as a skill plus deterministic local helper tools. The skill defines the workflow rules for update notices, session intent, test-path review, tagged generated tests, red-green implementation cycles, native tooling, coverage measurement, and follow-up questions [@skill]. Local tools handle deterministic worktree, backup, prompt-data, and plugin-update operations, while the user's current agent handles reasoning and generation [@skill] [@context-script] [@backup-script].

## Consequences

The decision keeps generation repository- and provider-agnostic. The README says Rudder uses the repository's own test and coverage tools and keeps test generation with the coding agent and model the user already uses [@product-readme]. It also keeps every follow-up question in the session where the feature was implemented, so user answers become captured prompt records for later generation passes [@skill]. The implemented helper layer can supply branch changes, captured prompts, update checks, and recoverable test backups, but the host agent still owns behavioral judgment and generated edits [@context-script] [@backup-script] [@skill].

The tradeoff is that Rudder's local workflow must express instructions clearly enough for supported coding agents to execute. The helper scripts can provide repository context, prompt records, update commands, and recoverable backups, but they do not determine behavioral intent or generate tests [@context-script] [@backup-script] [@skill]. Future product work should preserve this boundary unless a later decision explicitly moves model selection or generation into Rudder itself.
