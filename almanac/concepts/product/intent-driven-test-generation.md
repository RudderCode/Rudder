---
title: "Intent-Driven Test Generation"
summary: "Intent-driven test generation is Rudder's workflow for turning captured coding-session intent into an approved local spec, tagged tests, and spec-backed code changes."
topics: [concepts, product-intent, test-generation-intent, local-spec]
sources:
  - id: readme
    type: file
    path: README.md
  - id: prompt-hook
    type: file
    path: src/prompt-hook.ts
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
  - id: local-spec-script
    type: file
    path: skills/rudder/scripts/local-spec.mjs
  - id: spec-template
    type: file
    path: skills/rudder/references/spec-template.md
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
---

# Intent-Driven Test Generation

Intent-driven test generation is the Rudder product model in which a coding agent uses captured session prompts and worktree changes to maintain an approved local spec, then writes tests that are traceable to spec sections backed by user intent.
The README describes Rudder as a local Claude Code and Codex plugin that generates tests from prompts and uses coverage as a proxy for how much generated code reflects the developer's own decisions [@readme].
The current plugin implements that model by capturing submitted prompts, reconciling them to branches, returning branch prompts and spec candidates through the context helper, and requiring the skill to resolve a device-local spec before test generation [@prompt-hook] [@context-script] [@skill].

## Intent Source

The central input is the current coding-agent session.
Rudder runs as a plugin for the user's existing coding agent and stores prompt data locally, so the workflow can use captured prompts and later answers as product intent [@readme].
The approved behavior contract is now a device-local Markdown spec: repository specs are read-only import sources, generated specs use Rudder's template, and all amendments happen in the local copy [@skill] [@local-spec-script] [@spec-template].
[Prompt History](../runtime/prompt-history) covers the implemented local prompt store, while [Local Spec Store](../../architecture/runtime/local-spec-store) covers the branch-to-spec mapping [@prompt-hook] [@context-script] [@local-spec-script].

Worktree changes provide the other input.
`scripts/context.mjs` resolves a merge base, classifies changed test paths and production candidates, finds likely spec source files, and returns prompt records plus the active branch's local spec record when one exists [@context-script].
This makes the diff the implementation target, the prompt history the provenance input, and the approved local spec the behavioral target.

## Workflow Shape

Rudder resolves the local spec before it touches tests.
If a branch already has a valid local spec, the skill rereads it; if a relevant repository spec changed, the skill asks whether to keep, merge, or replace the local copy; if no relevant source exists, the skill creates a focused Markdown spec from captured intent through `local-spec.mjs` [@skill] [@local-spec-script].
Worktree changes may supply affected surfaces and vocabulary, but the skill forbids using them to create behavioral requirements [@skill].

After the spec is approved, Rudder starts from a controlled test reset.
The installed skill requires the agent to show exact tracked and untracked test paths, get explicit confirmation, create a recoverable backup, and then restore only the confirmed test paths to the merge-base state [@skill].
When a confirmed path already contains `rudder-spec: <section-id>` tags, the agent records those tagged test cases before the reset and attempts to restore only cases whose section still exists in the approved local spec, plus the smallest required supporting code [@skill].
The linked [Test Intent Standards](test-intent-standards) page explains the spec-section tag rules that decide which expectations can be generated or restored.

Every generated or rewritten test case must carry an immediately preceding `rudder-spec: <section-id>` comment, where the section is an approved local `REQ-NNN` or `EC-NNN` section that lists captured prompt provenance [@skill].
Coverage is loop control rather than a source of new expectations: when coverage is below target after a green first pass, the main agent asks one concrete question about an uncovered behavior, waits for a captured answer, amends and rereads the local spec, and only then writes the next test [@skill].

Captured answers can be implemented in bounded rewrite batches after they update the local spec.
The main agent may dispatch at most three disjoint red-green tasks between coverage runs, joins and verifies the whole batch, runs the combined test suites, and only then measures coverage again [@skill].
Every run ends with a temporary report that groups final adjacent-tagged tests by their exact spec section, reproduces the section's behavior fields and prompt provenance, and links test titles to source locations [@skill] [@context-script].

## Generation Ownership

The local version is bring-your-own-agent.
Rudder does not choose a model or make a separate model API call; the user's current coding agent generates tests with the model and credentials already configured for that agent [@readme] [@skill].
The product is therefore a skill-guided workflow backed by deterministic local context and worktree tools, not a provider-specific test generator [@readme] [@skill].
[BYOK Skill Workflow](../../decisions/product/byok-skill-workflow) records that product decision.

This ownership model keeps the feedback loop inside the coding session that produced the implementation.
Production changes are allowed only inside a spec-backed red-green cycle: write the tagged test first, observe the expected failure, make the smallest implementation change, rerun the narrow test, and measure coverage only after the suite is green [@skill].
Subagents may own isolated rewrites, but the current host agent remains the only question asker and owns intent interpretation, local spec amendments, integration, coverage, and the final spec-section report [@skill].
