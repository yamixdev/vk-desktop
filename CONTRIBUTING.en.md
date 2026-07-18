# Contributing to VK Desktop

[Русский](CONTRIBUTING.md) · [English](CONTRIBUTING.en.md)

Thank you to everyone who helps improve VK Desktop by reporting bugs, proposing
ideas, improving documentation, or contributing code.

VK Desktop is a source-available project, not open-source software. Before
contributing, review the [license](LICENSE), this guide, and the
[Code of Conduct](CODE_OF_CONDUCT.en.md).

## Ways to contribute

- **Bug report:** open an
  [Issue](https://github.com/yamixdev/vk-desktop/issues) and include the
  application version, Windows version, reproduction steps, expected behavior,
  and actual behavior.
- **Feature proposal:** describe the problem, use case, and expected benefit in
  an Issue.
- **Code or documentation:** submit a Pull Request using the process below.
- **Vulnerability or data exposure:** do not disclose it publicly; report it
  through [Telegram @ilushadevz](https://t.me/ilushadevz?direct).
- **Cooperation or special permission:** use the same Telegram account.

Remove tokens, cookies, session identifiers, personal data, and sensitive local
paths before publishing logs.

## Requests from organizations

Representatives of VK or another organization requesting cooperation, a rights
transfer, or special permission must provide reasonable, verifiable proof of
identity and authority. Suitable proof includes communication from an official
corporate domain or confirmation through another independently verifiable
official channel.

Identity documents and other sensitive information must not be posted in
Issues or Pull Requests.

## Cloning and forking

The [license](LICENSE) permits cloning or forking the official repository,
creating working branches, and modifying the code to prepare a good-faith Issue
or Pull Request for `yamixdev/vk-desktop`. A contribution fork may remain
available for as long as reasonably necessary to review and maintain the
contribution.

This permission does not allow contributors to:

- publish independent builds or installers based on the project;
- distribute standalone or derivative versions;
- use the code, name, logo, or other materials commercially without written
  permission;
- remove authorship or license notices; or
- present a fork as an official VK Desktop release or as wholly original work.

## Before starting

Open an Issue before implementing a new feature or a significant change to the
architecture, interface, updater, security model, or background behavior. Small
bug fixes, tests, and documentation improvements may be submitted directly.

Do not commit:

- tokens, cookies, passwords, certificates, or Chromium profile data;
- third-party code, artwork, or other material without compatible permission;
- generated `dist`, `node_modules`, or benchmark profiles;
- bundled VK Next changes without prior discussion, verified artifact
  provenance, and updated integrity metadata; or
- unrelated bulk formatting or accidental lockfile changes.

## Development environment

The primary target environment is:

- Windows x64;
- Node.js 24; and
- npm 11.

```powershell
git clone https://github.com/YOUR_NAME/vk-desktop.git
cd vk-desktop
git remote add upstream https://github.com/yamixdev/vk-desktop.git
npm ci
git switch -c feature/short-description
```

Use a short, descriptive branch name with an appropriate prefix such as
`fix/`, `feature/`, `docs/`, or `refactor/`.

## Verifying changes

Before submitting a Pull Request, run:

```powershell
npm run check
```

Add or update tests for changed behavior. The long performance benchmark is
required only for changes affecting memory usage, CPU load, background timers,
or application startup. When applicable, include the measurement scenario,
baseline conditions, and before-and-after results.

## Pull Request requirements

A Pull Request should:

1. summarize the problem and the chosen solution;
2. provide verification instructions;
3. reference the related Issue, when one exists;
4. describe known risks and limitations;
5. include screenshots for visible interface changes;
6. update documentation and tests where appropriate; and
7. avoid combining unrelated work.

Review the diff for secrets, temporary files, and accidental changes. The title
and description should make the purpose of the Pull Request understandable
without additional context.

## Review process

Project maintainers may request revisions, suggest another approach, defer
review, or close a Pull Request without merging it. Submitting a contribution
does not guarantee acceptance or establish a response deadline.

Technical decisions consider security, maintainability, performance, project
direction, and licensing requirements.

## Contribution rights

By submitting code, documentation, artwork, or another contribution, a
contributor confirms that they have the necessary rights and accepts the
**Contributions** section of the [LICENSE](LICENSE).

Contributors retain copyright in their original work while granting the project
a perpetual license to use, modify, distribute, sublicense, and relicense that
work as part of VK Desktop. This allows the project to accept, maintain, and
distribute contributed changes.

A contribution does not change the license of VK Desktop as a whole or grant
permission to publish a separate product based on it.

## Community interaction

Participation in Issues, Pull Requests, and other project spaces is governed by
the [Code of Conduct](CODE_OF_CONDUCT.en.md).
