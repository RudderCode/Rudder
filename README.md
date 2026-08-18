<div align="center">
  <img src="./assets/rudder-banner.svg" alt="Rudder" width="100%" />
</div>

# Rudder 🫧

<div align="center">
  <p><strong>Effortless, actually comprehensive specs.</strong></p>
  <p>
    <a href="https://github.com/RudderCode/Rudder/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/RudderCode/Rudder?logo=github"></a>
    <a href="https://www.npmjs.com/package/@ruddercode/rudder-plugin"><img alt="npm downloads" src="https://img.shields.io/npm/dm/%40ruddercode%2Frudder-plugin?logo=npm"></a>
    <a href="https://www.npmjs.com/package/@ruddercode/rudder-plugin"><img alt="npm" src="https://img.shields.io/npm/v/%40ruddercode%2Frudder-plugin?label=npm&color=orange&logo=npm&logoColor=white"></a>
    <a href="https://discord.gg/tmjdmhp4xD"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?logo=discord&logoColor=white"></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/RudderCode/Rudder?color=blue"></a>
  </p>
</div>

Rudder is a local plugin for Claude Code and Codex that makes verifiably comprehensive specs from
your session history and any existing specs. Rudder then uses specs to generate unit tests, turning
test coverage into a proxy for how comprehensive your specs really are.

<strong>Why use it:</strong> 

> "I want my agents to stop guessing when coding, but I don't want to have to pre-write super long specs"

Rudder solves this by retrospectively writing specs for you based on your prompt history, then asking you
questions until the spec is comprehensive enough to stop any guesswork.

> "I love Spec-Driven Development, but I'm worried my specs aren't comprehensive enough"

Rudder starts with the spec you give it, generates a coverage percentage showing how well your spec covers
your agent's code, and then asks you questions to improve your spec until its sufficiently comprehensive.

<strong>How it works:</strong> 
1. Rudder installs hooks in your coding agents to record the repository and branch that your agents
are working in. When invoked at the end of a session, Rudder uses your prompt history and any existing
specs it finds in your branch to generate its own maximally comprehensive spec.
2. Rudder instructs your agent to rewrite unit tests with the requirement that each test is tied
directly to a requirement in the spec document.
3. Rudder asks you targeted questions about the change you want to make until your spec covers the
code your agent has written. When you pass test coverage, you know your spec is actually comprehensive.

Rudder uses the repository's own test and coverage tools, and test generation stays with the coding agent and model
you already use.

## Quick start

### Requirements

- Node.js 24 or newer
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
- <strong>Bring your own workflow (BYOW):</strong> Rudder is fully compatible
with your existing coding workflow, whether you use spec-kit, grill-me, plan mode,
another SDD approach, or just raw prompting.
- <strong>Bring your own agent (BYOA):</strong> Rudder is a plugin for your
existing coding agent, and runs directly in your agent's coding session.
- <strong>Multi-agent support:</strong> Install hooks into each of your coding
agents to aggregate sessions across multiple providers.
- <strong>Local storage:</strong> Your prompt data used by Rudder is stored in
a local SQLite DB and never leaves your device.
- <strong>Easy setup:</strong> Plugin installation is the only requirement to
get started using Rudder.

## Local data and privacy

The prompt hook links submitted prompts to the active repository and branch.
Records are stored in a local SQLite database:

```text
~/.rudder/rudder.db
```

Set `RUDDER_HOME` to use a different state directory.

The current plugin does not transmit captured prompts to RudderCode.
Your coding agent may process that context when you invoke Rudder.
Its provider terms and configuration still apply.

You can also ask the installed skill to:

- show the local storage path, capture status, and prompt count; or
- delete all stored prompt records after explicit confirmation.

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

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

<a href="https://github.com/pouyashahrdami/github-pulse">
  <img
    alt="Rudder repository pulse"
    src="https://github-pulse-topaz.vercel.app/r/RudderCode/Rudder?theme=mono&amp;size=wide&amp;w=full&amp;label=Rudder%20Contributions"
  />
</a>

## Documentation

- [Installation](./docs/install.md)
- [Privacy](./docs/privacy.md)
- [Support](./docs/support.md)
- [Terms of use](./docs/terms.md)

## License

Rudder is licensed under the [Apache License 2.0](./LICENSE).
