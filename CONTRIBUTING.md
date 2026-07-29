# Contributing to Rudder

Thanks for helping improve Rudder! We really appreciate your support :)

Here's some general guidelines to help you get started:
- [Issues](#issues)
- [Pull Requests](#pull-requests)
- [Getting Started](#getting-started)
- [AI-assisted Contributions](#ai-assisted-contributions)

## Issues

Use [GitHub Issues](https://github.com/RudderCode/Rudder/issues) for bugs, installation problems, and security or privacy concerns.

For a substantial feature or design change, open an issue before investing in
an implementation so the intended behavior and scope can be agreed on.

## Pull Requests

We actively welcome your Pull Requests! A couple of things to keep in mind before you submit:

- If you're fixing an issue, make sure someone else hasn't already created a PR fixing the same issue. Link your PR to the related issue(s).
- If you're new, we encourage you to take a look at issues tagged with good first issue.
- If you're submitting a new feature, please open an issue first to discuss it before opening a PR.

## Getting Started

You need:

- Node.js 24 or newer
- npm
- Git

Fork and clone the repository, then install the locked dependency set:

```bash
git clone https://github.com/<your-user>/Rudder.git
cd Rudder
npm install
```

Create a focused branch from the latest `main`:

```bash
git switch main
git pull --ff-only
git switch -c <type (e.g. feat, fix, etc.)>/<short-description>
```

The project is one ESM TypeScript package. 
See the [installation guide](docs/install.md) for local development setup.

Please note that the following folders are auto-generated and should be considered read-only paths:

| Path | Purpose |
| --- | --- |
| `drizzle/` | Generated SQLite migrations shipped with the plugin |
| `almanac/` | Maintained architectural and operational context |

## AI-assisted Contributions

Every coding agent that writes code must be identifiable in the commit history.
This is used to guardrail against agents making changes to protected regions of the codebase (see [dangerfile.ts](dangerfile.ts)).
Use the agent as the commit author or add a trailer such as:

```text
Co-authored-by: Codex Agent <codex-agent@openai.com>
```

The name must clearly identify the coding agent.
Human-only changes do not need agent attribution.

## License

By contributing to Rudder, you agree that your work will be licensed under the
[Apache License 2.0](LICENSE).
