---
title: "Intent-Driven Test Generation"
summary: "Intent-driven test generation is Rudder's workflow for turning captured coding-session intent into tagged tests and prompt-backed code changes."
topics: [concepts, product-intent, test-generation-intent]
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
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
---

# Intent-Driven Test Generation

Intent-driven test generation is the Rudder product model in which a coding agent uses captured session prompts and worktree changes to write tests that are traceable to user intent. The README describes Rudder as a local Claude Code and Codex plugin that generates tests from prompts and uses coverage as a proxy for how much generated code reflects the developer's own decisions [@readme]. The current plugin implements the local context layer by capturing submitted prompts, reconciling them to branches, and giving the Rudder skill a JSON view of branch prompts plus changed paths [@prompt-hook] [@context-script].

## Intent Source

The central input is the current coding-agent session. Rudder runs as a plugin for the user's existing coding agent and stores prompt data locally, so the workflow can use captured prompts and later answers as product intent instead of requiring a separate specification document [@readme]. [Prompt History](../runtime/prompt-history) covers the implemented local prompt store that supplies this context to the skill [@prompt-hook] [@context-script].

Worktree changes provide the other input. `scripts/context.mjs` resolves a merge base, classifies changed test paths and other paths, and returns prompt records for the active repository branch [@context-script]. This makes the diff the implementation target and the prompt history the behavioral target.

## Workflow Shape

Rudder starts from a controlled test reset before generation. The installed skill requires the agent to show exact tracked and untracked test paths, get explicit confirmation, create a recoverable backup, and then restore only the confirmed test paths to the merge-base state [@skill]. When a confirmed path already contains Rudder source-intent tags, the agent records those tagged test cases before the reset and attempts to restore only those cases plus the smallest required supporting code afterward [@skill]. The linked [Test Intent Standards](test-intent-standards) page explains the direct-intent and source-tag rules that decide which expectations can be generated or restored.

After the reset, every generated or rewritten test case must carry an immediately preceding source-intent comment in `<source>/<sessionId>/<promptId>` form, using identifiers from captured prompt records rather than prompt text [@skill]. Coverage is loop control rather than a source of new expectations: when coverage is below target after a green first pass, the main agent asks one concrete question about an uncovered behavior and waits for a captured answer before writing the next test [@skill].

Captured answers can be implemented in bounded rewrite batches. The main agent may dispatch at most three disjoint red-green tasks between coverage runs, joins and verifies the whole batch, runs the combined test suites, and only then measures coverage again [@skill]. Every run ends with a temporary report that groups final adjacent-tagged tests by their exact captured prompt, preserves prompt text, summarizes prior agent context, and links test titles to source locations [@skill] [@context-script].

## Generation Ownership

The local version is bring-your-own-agent. Rudder does not choose a model or make a separate model API call; the user's current coding agent generates tests with the model and credentials already configured for that agent [@readme] [@skill]. The product is therefore a skill-guided workflow backed by deterministic local context and worktree tools, not a provider-specific test generator [@readme] [@skill]. [BYOK Skill Workflow](../../decisions/product/byok-skill-workflow) records that product decision.

This ownership model keeps the feedback loop inside the coding session that produced the implementation. Production changes are allowed only inside a prompt-backed red-green cycle: write the tagged test first, observe the expected failure, make the smallest implementation change, rerun the narrow test, and measure coverage only after the suite is green [@skill]. Subagents may own isolated rewrites, but the current host agent remains the only question asker and owns intent interpretation, integration, coverage, and the final prompt report [@skill].
