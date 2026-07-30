---
title: "Test Intent Standards"
summary: "Test intent standards define how Rudder ties generated tests, restored test cases, coverage questions, rewrite batches, and final reports to captured user intent."
topics: [concepts, product-intent, test-generation-intent]
sources:
  - id: skill
    type: file
    path: skills/rudder/SKILL.md
  - id: backup-script
    type: file
    path: skills/rudder/scripts/backup-tests.mjs
  - id: context-script
    type: file
    path: skills/rudder/scripts/context.mjs
---

# Test Intent Standards

Test intent standards are the rules that keep Rudder's generated unit tests grounded in what the user directly intended during a coding session. They require generated or rewritten test cases to be traceable to captured prompt records, reset confirmed test paths through a recoverable backup, preserve only Rudder-tagged generated tests after that reset when they can be isolated, use narrow questions to resolve uncovered behavior, isolate parallel rewrites, and produce a final test-to-prompt report [@skill]. These standards sit inside [Intent-Driven Test Generation](intent-driven-test-generation) and constrain the [BYOK Skill Workflow](../../decisions/product/byok-skill-workflow).

## Direct Intent

The direct-intent standard applies to every generated or expanded expectation. The skill says to generate or expand a test only when a captured user prompt or answer explicitly requires the expectation, and it forbids adding tests merely to execute uncovered code, match the implementation, improve coverage, or exercise a defensive case [@skill].

This rule prevents regenerated tests from silently accepting behavior just because a test file already changed or a coverage report has an uncovered branch. The source of truth for a changed expectation is the user's captured intent, not the mere presence of a changed assertion, fixture, or implementation branch [@skill].

## Fresh Test Slate

The fresh test slate is the reset that happens before generation begins. The skill requires the agent to show the exact tracked and untracked test paths, get explicit confirmation, back up only those paths, verify the backup, and restore only the confirmed paths to the merge-base state [@skill]. `backup-tests.mjs` supports that scope by requiring each affected path explicitly, rejecting paths outside the repository, writing a binary-capable tracked patch, and copying listed untracked test files into the backup [@backup-script].

The reset has a narrow restoration exception for previously generated Rudder tests. Before clearing confirmed paths, the agent inspects them for test cases with an immediately preceding source-intent tag, records those cases and tags, and after the reset attempts to restore only those cases plus the smallest required supporting code [@skill]. A tag on a helper, fixture, or non-adjacent comment is not enough, and untagged tests must not be restored wholesale [@skill].

## Source-Intent Tags

Every generated or rewritten test case gets one language-appropriate comment immediately above the test case in `<source>/<sessionId>/<promptId>` form [@skill]. The identifiers come from captured prompt records returned by `scripts/context.mjs`, and the skill forbids copying prompt text into test code [@skill].

The tag is a traceability contract, not a decoration. It identifies which captured prompt authorized the expectation, lets a later Rudder reset preserve only generated tests that still have adjacent source tags, and keeps unchanged preexisting tests, shared helpers, and fixtures outside the generated-test set [@skill].

## Questions And Coverage

Rudder should ask questions only when they resolve an ambiguity that changes a test expectation. After the first green test pass, if coverage is below target, the skill requires the agent to stop editing tests, select one uncovered behavior, ask one concrete question, and wait for the user's answer before writing the next test [@skill].

Coverage is the loop control, not the source of intent. The skill requires a captured prompt record for each follow-up answer before adding the expectation that answer authorizes, and it stops below target when the answer is missing, declined, or not captured [@skill]. Contributors use [Run Checks](../../guides/contributor/run-checks) for the repository's validation procedure outside this product-generation loop.

## Rewrite Ownership

Only the main agent may ask questions or interpret a follow-up answer [@skill]. It can queue at most three independent rewrite tasks between coverage runs and at most three concurrent subagents, with each task carrying one authorized expectation, its exact source-intent tag, disjoint file ownership, repository instructions, and a narrow test command [@skill]. Rewrite workers may perform only their assigned red-green cycle; they may not ask questions, spawn agents, run coverage, commit, or cross their assigned path boundary [@skill].

Coverage cannot be measured while any rewrite is pending. The main agent joins the batch, verifies tags and ownership in the combined diff, repairs failures serially, and reruns related and full suites before another coverage snapshot [@skill]. When work cannot be divided safely, the same authorized expectations run serially rather than weakening the ownership boundary [@skill].

## Report Provenance

The final report uses the source tag as a relational key rather than treating nearby prompts or agent memory as provenance [@skill]. After refreshing `scripts/context.mjs`, the agent matches each final generated, rewritten, or restored tagged test to the exact captured record identified by `<source>/<sessionId>/<promptId>`, groups tests once per prompt, and omits prompts with no final tagged tests [@skill] [@context-script].

The report must preserve `promptText` exactly, reduce `previousAgentOutput` to a concise faithful representation or `N/A`, and identify tests by human-readable title plus path and starting line rather than copying test bodies [@skill]. It lives in a unique temporary file outside the repository and is produced for completed and intentionally stopped runs, keeping user-facing provenance separate from the committed test source [@skill].
