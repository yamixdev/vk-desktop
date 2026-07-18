<div align="center">

# VK Desktop

[Русский](README.md) · [English](README.en.md)

<img src="assets/vk_logo.png" alt="VK Desktop by yamixdev" width="900">

![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11&logoColor=white)
![Electron 43.1.1](https://img.shields.io/badge/Electron-43.1.1-47848F?logo=electron&logoColor=white)
![License: Proprietary](https://img.shields.io/badge/license-proprietary-C62828)

An unofficial VK client for Windows that combines the VK web interface, VK Next,
and desktop integration in a single application window.

</div>

## Features

- VK in a dedicated window with native Windows integration.
- Optional VK Next integration with version, file-set, and checksum validation.
- Discord Rich Presence for the currently playing track.
- Tray media controls and SPA navigation to Messages, Music, and Home without a
  full VK page reload.
- Unread-message badges, notifications, and minimize-to-tray behavior.
- Performance profiles and conservative background memory cleanup.
- Built-in update checks and a Windows x64 installer.

## Installation

1. Open the [latest release](https://github.com/yamixdev/vk-desktop/releases/latest).
2. Download `VK-Desktop-Setup-<version>.exe`.
3. Run the installer and select an installation directory.

> [!WARNING]
> The project does not currently use a commercial Authenticode certificate.
> Windows SmartScreen may therefore display an “Unknown publisher” warning.
> Releases should only be downloaded from the official `yamixdev/vk-desktop`
> repository.

## VK Next

VK Next is enabled by default and is managed from the `☰` menu in the window
header. Enabling or disabling the extension reloads the VK page. Before loading
it, the client validates the version, complete file set, and SHA-256 checksum
against pinned metadata. The same menu provides access to VK Next settings.

VK Next is a third-party component. Its respective rights remain with its
owners; the VK Desktop proprietary license does not claim those rights.

## Memory and background operation

Chromium and V8 remain responsible for most memory management. VK Desktop only
requests additional collection for an oversized renderer after the window has
remained in the background for a sustained period. It skips collection while
music is playing, the page is loading, or DevTools is attached, and enforces a
long cooldown between requests.

The VK page is deliberately kept alive because discarding it would stop
background playback and notifications. Memory usage is not a fixed target; it
varies with the active section, VK Next, the GPU process, and session length.

## Building from source

Windows x64, Node.js 24, and npm 11 are required.

```powershell
git clone https://github.com/yamixdev/vk-desktop.git
cd vk-desktop
npm ci
npm start
```

Build the installer:

```powershell
npm run build
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run check` | Lint, quick unit tests, and VK Next integrity check |
| `npm run build:dir` | Unpacked Windows x64 build |
| `npm run build` | NSIS installer without publishing |
| `npm run publish` | Build and publish a release; signing is optional |

## Security

- Remote content runs without Node.js integration.
- The renderer uses sandboxing and context isolation.
- IPC accepts schema-validated messages only from the main VK frame.
- External URLs open in the system browser without loading VK's redirector in
  the client.
- Local service pages are served from a fixed `vk-desktop://local` allowlist.
- Production builds validate ASAR integrity and disable dangerous Electron
  fuses.

## License and authorship

Copyright © 2026 **yamixdev**. The source code is published under a
[proprietary source-available license](LICENSE); this project is **not open
source**. The license permits source review, personal use of unmodified official
builds, private evaluation builds, and changes made to prepare a Pull Request for
this repository.

Written permission is required to distribute original or modified builds, use
the project commercially, incorporate its code into another project, or claim
different authorship. A public repository or GitHub fork does not grant those
rights.

## Suggestions, Pull Requests, and cooperation

Bug reports and improvement proposals are welcome through
[GitHub Issues](https://github.com/yamixdev/vk-desktop/issues) and
[Telegram](https://t.me/ilushadevz?direct).

The repository may be cloned or forked to prepare a Pull Request. Environment
setup, change requirements, and the submission process are documented in the
[contribution guide](CONTRIBUTING.en.md) and
[Code of Conduct](CODE_OF_CONDUCT.en.md). Distribution and reuse remain governed
by the [license](LICENSE).

Companies, VK representatives, and potential partners can contact the author at
[Telegram: @ilushadevz](https://t.me/ilushadevz?direct). Requests concerning an
official partnership, rights transfer, or special permission must include
reasonable, verifiable proof of identity and authority, such as a message from
an official corporate domain or confirmation through another official channel.

## No affiliation

VK Desktop is an independent unofficial project. It is not affiliated with,
endorsed by, or supported by VK. All names and trademarks belong to their
respective owners.
