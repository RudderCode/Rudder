<div align="center">
  <img src="./assets/rudder-banner.svg" alt="Rudder" width="100%" />
</div>

# Rudder 🫧

<div align="center">
  <p><strong>Measure your own input on AI generated code.</strong></p>
  <p>
    <a href="https://github.com/RudderCode/Rudder/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/RudderCode/Rudder?logo=github"></a>
    <a href="https://www.npmjs.com/package/@ruddercode/rudder-plugin"><img alt="npm downloads" src="https://img.shields.io/npm/dm/%40ruddercode%2Frudder-plugin?logo=npm"></a>
    <a href="https://www.npmjs.com/package/@ruddercode/rudder-plugin"><img alt="npm" src="https://img.shields.io/npm/v/%40ruddercode%2Frudder-plugin?label=npm&color=orange&logo=npm&logoColor=white"></a>
    <a href="https://discord.gg/tmjdmhp4xD"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?logo=discord&logoColor=white"></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/RudderCode/Rudder?color=blue"></a>
  </p>
</div>

Rudder is a local plugin for Claude Code and Codex that generates tests directly
from your prompts. Rudder forces your agent to write tests solely from your
session history, turning test coverage into a proxy for how much of your generated
code resulted from your own decision making.

<strong>Why use it:</strong> Coding agents are now generating mass amounts of code, but with very
little oversight into whether that code actually reflects the intent of the author.
Rudder solves this by using the age-old method of checking if code does what its 
supposed to do--unit testing.

<strong>How it works:</strong> Rudder uses hooks in your coding agent to record the repository and branch
that your prompts are written in relation to. When invoked at the end of a session, Rudder
instructs your agent to rewrite unit tests with the requirement that each test is justified
explicitly by the recorded prompts. Rudder uses the repository's own test and coverage tools,
and test generation stays with the coding agent and model you already use.

## Quick start

### Requirements

- Node.js 23.6 or newer
- npm and Git on `PATH`
- A current Claude Code or Codex installation with plugin support

### Claude Code

Add the Rudder marketplace:

```text
/plugin marketplace add RudderCode/Rudder
```

Install the plugin:

```text
/plugin install rudder@rudder
```

Restart the session before running Rudder.

### Codex

Add the Rudder marketplace:

```text
codex plugin marketplace add RudderCode/Rudder
```

Install the plugin:

```text
codex plugin add rudder@rudder
```

Start a new Codex session and review the bundled prompt hook when Codex asks
you to trust it.

### Run Rudder

Build your feature in a Git branch as usual, then ask your agent:

> Run Rudder

You can also provide it an explicit coverage target:

> Use $rudder to verify this branch at 90% coverage.

Rudder inspects the branch and session before proposing a test reset.
Review the exact paths if tests have already changed.
Approve the backup and reset only when those paths are correct.

## Features

## Local data and privacy

The prompt hook links submitted prompts to the active repository and branch.
Records are stored in a local SQLite database:

```text
~/.rudder/rudder.db
```

Set `RUDDER_HOME` to use a different state directory.
Set `RUDDER_DISABLE_PROMPT_CAPTURE=1` to disable future capture.

The current plugin does not transmit captured prompts to RudderCode.
Your coding agent may process that context when you invoke Rudder.
Its provider terms and configuration still apply.

You can also ask the installed skill to:

- show the local storage path, capture status, and prompt count;
- disable or enable future prompt capture; or
- delete all stored prompt records after explicit confirmation.

Disabling capture does not delete existing records.
See the [privacy notice](./docs/privacy.md) for the complete data-handling description.

## Development

Clone the repository, install dependencies, and run the validation suite:

```bash
npm ci
npm run format:markdown:check
npm run typecheck
npm test
npm run build
```

`npm test` uses Node's built-in test runner and rebuilds the bundled prompt hook
before running the suite.

To load the repository directly in Claude Code during development:

```bash
claude --plugin-dir .
```

See the [installation guide](./docs/install.md) for local Codex setup and the
published-package workflow.

## Contributing

## Documentation

- [Installation](./docs/install.md)
- [Privacy](./docs/privacy.md)
- [Support](./docs/support.md)
- [Terms of use](./docs/terms.md)

## License

Rudder is licensed under the [Apache License 2.0](./LICENSE).
