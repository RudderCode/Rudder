---
name: rudder
description: Use locally captured coding-session intent to generate focused tests, implement the smallest production changes through red-green TDD, and verify coverage with the repository's native tooling. Use when the user asks to run Rudder, create or regenerate tests for current work, reach a coverage target, inspect captured Rudder context, delete Rudder prompt data, or responds to a Rudder update notice. Do not use for unrelated test maintenance or standalone production changes.
---

# Rudder

Use the current coding agent to derive tests and production changes from intent.
Keep prompt data and generation local; do not call a separate model or service.

## Check for updates at invocation start

Start each Rudder test-generation invocation with `scripts/update.mjs check`.
Run it relative to this file exactly once before any test-generation work.
Do not interrupt the run when the check is unavailable.

If `shouldNotify` is true, immediately show this notice:

```text
Rudder <latestVersion> is available—you are using <currentVersion>.
Would you like to update to the latest version?
```

Use that text exactly.
Continue the current Rudder run without waiting for an answer.
If the user does not agree to update, show the notice on the next invocation.

## Handle update-notice responses

When the user agrees to update Rudder, handle the response:

- Identify Codex or Claude Code.
  Run `scripts/update.mjs apply --host <host>` relative to this file.
  Use `codex` or `claude-code` for `<host>`.
  The user's affirmative response is the required authorization to update.
- If the helper reports `updated`, report its `nextStep`.
- On `failed`, report the failure and continue the active Rudder flow.
- For any other response, take no update action.

## Handle data-control requests

For requests to inspect or delete Rudder data, use
`scripts/manage-data.mjs` relative to this file:

```text
node <skill-directory>/scripts/manage-data.mjs status
node <skill-directory>/scripts/manage-data.mjs delete --confirm
```

Explain that `delete --confirm` irreversibly removes all prompt records.
Do not run deletion without the user explicitly requesting it.
Stop after completing a data-control request.

## Enforce question-driven coverage

Coverage is loop control, never a source of test intent.

- Generate or expand a test only when a captured user prompt or answer
  explicitly requires its expectation.
- Never add a test merely to execute an uncovered line or branch, match the
  implementation, improve coverage, or exercise a defensive case.
- After the first test pass, if coverage is below the target, stop editing tests.
  Select one uncovered behavior.
  Increment the run's question counter and best-effort record the question before showing it:

  ```text
  node <skill-directory>/scripts/telemetry.mjs question-asked \
    --cwd <repository-root> \
    --run-id <rudder-run-id> \
    --question-number <question-counter>
  ```

  Do not pass the question or any answer text to the helper.
  Ask one concrete question about the expected behavior.
- Do not write the next test until the user answers.
  Repository code may help frame the question, but it cannot supply the answer.
- After each answer, rerun `scripts/context.mjs` with `--phase refresh`, `--run-id <rudder-run-id>`, and `--base <resolved-base-ref>`.
  Require a captured prompt record for the answer, and queue only the expectation that answer authorizes.
- Complete the red-green cycle for every authorized expectation in its owning agent before integrating the batch.
  Use the queue answered rewrites guidance to set up owning agents.
  Do not measure coverage while a rewrite is pending.
- If the answer is missing, declined, or not captured, stop below the target.
  Report the uncovered behavior.
  Never fill the gap by inference.

## Queue answered rewrites

Only the main agent may ask the user questions.
The main agent owns intent interpretation, the rewrite queue, integration, and coverage.

- After capturing an answer, prepare one bounded rewrite task with the authorized
  expectation, exact source-intent tag, allowed test and production paths,
  relevant repository instructions, and narrow test command.
- Use at most three rewrite subagents at once and dispatch no more than three tasks between coverage runs.
  Dispatch each safe task without waiting so the main agent can continue the question flow.
  If the host cannot launch subagents, execute the same tasks serially.
- Assign disjoint behavior and file ownership to every subagent.
  Include the current worktree state in the task and tell the subagent not to undo user or other-agent changes.
  If ownership cannot be made disjoint, run that rewrite serially in the main agent.
- Limit each subagent to its assigned rewrite.
  Require it to write and tag the test, observe red, make the smallest production change, reach narrow green, and report files and commands.
  Forbid it from asking questions, spawning agents, running coverage, committing, or editing outside its assigned paths.
- While fewer than three tasks have been dispatched since the last coverage run, continue from that coverage snapshot only when another unassigned, independent uncovered behavior is available and its question does not depend on a pending rewrite.
  Ask exactly one question at a time.
- Do not ask another question after dispatching the third task.
  Also stop dispatching when no safe independent task remains, the user stops, or an answer is missing.
- Wait for every subagent in the batch to finish before integration.
  Inspect each result and the combined diff, verify its tag and path ownership, and complete a failed or invalid rewrite serially.
  Run the related and full suites on the combined worktree.
  Run coverage only after the joined suite is green.

## Enforce red-green TDD

For every new or changed expectation:

1. Write and tag the focused test before changing production code.
2. Run the narrowest test and observe the expected failure.
   Confirm it fails because the required behavior is missing.
   If the test is wrong, correct it and rerun it.
   Do not weaken the prompt-backed expectation.
   If it already passes, do not change production code for that expectation.
3. Make the smallest production change required to satisfy the expectation.
   Do not change unrelated behavior or weaken the test.
   Do not alter coverage configuration or thresholds.
4. Rerun the narrow test until it passes.
   For a queued rewrite, return the result to the main agent for batch integration.
   Otherwise, run the applicable related and full test commands.
5. Measure coverage only after the suite is green.

## Present the prompt report

End every Rudder test-generation run by presenting a temporary Markdown report.
Create or refresh it only after all rewrites have joined and the final test results are known.
Do not create it while a user answer or rewrite is pending.

1. Rerun `scripts/context.mjs` so the report includes the latest captured follow-up answers:

   ```text
   node <skill-directory>/scripts/context.mjs \
     --cwd <repository-root> \
     --phase refresh \
     --run-id <rudder-run-id> \
     --base <resolved-base-ref>
   ```

2. Inspect the final affected test paths.
   Include each generated, rewritten, or restored test case only when it still has an immediately preceding Rudder source-intent tag.
   Match that exact `<source>/<sessionId>/<promptId>` tag to a captured prompt record; use the tag, not memory or test-file proximity, to choose the prompt group.
3. Consolidate the included tests into one group per prompt.
   List every final test case once under its matched prompt, and omit prompts that inspired no final test.
   Use each test's human-readable title or description, never its code body.
   Copy `promptText` exactly from the matched database record; do not truncate, summarize, or paraphrase it.
   Make a concise, faithful representation of `previousAgentOutput`.
   Do not reproduce long raw previous output or add context from model memory, the implementation, or the test diff.
   When `previousAgentOutput` is null, use `N/A` as the context representation.
4. Write the report to a uniquely named Markdown file in the operating system's temporary directory, outside the repository worktree.
   Never stage it or include it among the repository files changed.
   Use this shape:

   ```markdown
   # The tests your prompts inspired:

   ## Prompt 1

   | Exact prompt text | Prior agent context |
   | --- | --- |
   | <exact promptText> | <concise representation of previousAgentOutput> |

   - [<test title> (<repository-relative test path>:<starting line>)](<absolute local test path with line target>)
   - [<test title> (<repository-relative test path>:<starting line>)](<absolute local test path with line target>)

   ## Prompt 2

   | Exact prompt text | Prior agent context |
   | --- | --- |
   | <exact promptText> | <concise representation of previousAgentOutput> |

   - [<test title> (<repository-relative test path>:<starting line>)](<absolute local test path with line target>)
   ```

   Escape table-cell, test-title, and path text when needed to keep the Markdown valid.
   Format every bullet's visible text as `<test title> (<repository-relative path>:<starting line>)`.
   Link that entire text to the test case's starting line when the host supports local file links; otherwise render the same text without a link.
   If there are no final tagged tests, write `No prompt-backed tests were generated.` below the report heading.
5. Make the report the lead item in the final response.
   Show its contents and provide its temporary file path or local file link.

## Run the workflow

1. Determine the repository root and target branch from the request.
   Determine the requested coverage target.
   Prefer the repository's configured coverage threshold.
   Ask for a target only when neither the request nor repository provides one.
2. Run `scripts/context.mjs` relative to this file with the repository working directory:

   ```text
   node <skill-directory>/scripts/context.mjs \
     --cwd <repository-root> \
     --phase start \
     [--base <target-ref>]
   ```

   Retain the returned `rudderRunId` and `baseRef` for every later helper call in this run.
   Use that returned `baseRef` as `<resolved-base-ref>` in every later context, backup, and completion helper call.
   Initialize the run's question counter to zero.
3. Inspect the returned merge base, changed paths, and captured prompts.
   Inspect repository instructions, the production diff, and existing tests.
   Inspect the native test and coverage configuration.
   Treat helper classifications as candidates.
   Correct them using repository conventions.
4. Turn only directly expressed, captured user intent into behavioral requirements.
   Every generated expectation must be traceable to a prompt record.
   Otherwise, follow the question-driven coverage rules above.
5. Show the exact tracked and untracked test paths that would be affected.
   Before clearing them, inspect each confirmed path for test cases with an immediately preceding Rudder source-intent tag in the required format:

   ```text
   <language comment> <source>/<sessionId>/<promptId>
   ```

   Record the exact tagged test cases and their tags.
   Do not treat a tag on a helper, fixture, or a non-adjacent comment as a generated test.
   Request explicit confirmation before clearing any test change.
   Do not proceed on silence or an ambiguous reply.
6. After confirmation, create a recoverable backup for the exact approved paths:

   ```text
   node <skill-directory>/scripts/backup-tests.mjs \
     --cwd <repository-root> \
     --base <resolved-base-ref> \
     --run-id <rudder-run-id> \
     --path <test-path> \
     [--path <test-path> ...]
   ```

   Verify the reported patch and copied untracked files exist.
   Then restore only the confirmed test paths to the merge-base state.
   After that reset, attempt to restore each recorded, tagged test case with its intent tag.
   Restore only the smallest imports, fixtures, or helpers required for those test cases to compile; do not restore untagged tests or the entire test file.
   If a tagged test cannot be isolated and restored reliably, leave it in the backup and report the unsuccessful restoration.
   Never use `git reset --hard`, broad `git clean`, or change production files.
7. Generate the first pass of focused unit tests from already captured intent.
   Follow existing organization, fixtures, naming, and framework conventions.
   Do not change coverage configuration or repository thresholds.
8. Tag every generated or rewritten test case with its source intent.
   Add a single language-appropriate line comment immediately above the test case.
   Use identifiers from the captured prompt record that requires the expectation:

   ```text
   // <source>/<sessionId>/<promptId>
   ```

   Copy each identifier exactly as returned by `scripts/context.mjs`.
   Never copy prompt text into the test code.
   When multiple prompts directly contribute, tag with the most relevant prompt.
   Rerun the context helper after a follow-up answer to get its prompt record.
   Do not tag unchanged preexisting tests, shared helpers, or fixtures.
9. Run the red-green TDD cycle for every prompt-backed expectation.
10. When the suite is green, run the applicable coverage command.
    Measure changed production code when the tooling supports it.
    If coverage is below the target, follow the question-driven coverage loop.
11. Ask exactly one question at a time to the user.
    After the answer is captured, queue only its authorized expectation using the bounded rewrite workflow.
    Continue asking independent questions until the batch must join.
    After joining, run the combined suites and coverage before selecting another uncovered behavior.
    Continue until the target passes or the user tells you to stop the flow.
12. Before the final report, record the verified Rudder outcome:

    ```text
    node <skill-directory>/scripts/telemetry.mjs complete \
      --cwd <repository-root> \
      --base <resolved-base-ref> \
      --run-id <rudder-run-id> \
      --status <completed|stopped|blocked> \
      --tests-passed <yes|no|unknown> \
      --coverage-target-met <yes|no|unknown> \
      --questions-asked <question-counter>
    ```

    Use `completed` when the workflow reaches its normal report, `stopped` when it ends by user choice or missing intent, and `blocked` only for an external blocker.
    Set test and coverage values only from command output already observed during this run.
    Telemetry is best-effort; do not change the workflow result if this helper is unavailable.
13. After the generation loop ends, create and present the prompt report.

Report the requirements derived from intent and all files changed.
Report commands run, coverage, unanswered ambiguities, and the backup location.
Never claim the target passed without command output that demonstrates it.
