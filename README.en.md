<div align="center">

# VK Desktop

### Archived

[Русский](README.md) · [English](README.en.md)

<img src="assets/vk_logo.png" alt="VK Desktop by yamixdev" width="900">

![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11\&logoColor=white)
![Electron 43.2.0](https://img.shields.io/badge/Electron-43.2.0-47848F?logo=electron\&logoColor=white)
![Status: Archived](https://img.shields.io/badge/status-archived-6E7781)

An unofficial desktop client for VK on Windows, built with Electron.

</div>

> [!IMPORTANT]
> **This project has been archived and is no longer maintained.**
>
> I no longer have the time or motivation to continue developing it.
>
> VK Desktop was originally built as an Electron wrapper around the VK web interface. In retrospect, this was not the best architectural decision. A better approach would have been to build a custom interface from scratch and use the VK API wherever possible.
>
> However, the public VK API does not expose the full set of features available in the official client, so achieving complete feature parity with a fully custom interface would still have been difficult without relying on internal APIs.
>
> The repository is preserved in its archived state.

## What was implemented

* VK in a dedicated desktop window with Windows integration.
* VK Next integration.
* Discord Rich Presence for music playback.
* Music controls and quick navigation through the system tray.
* Unread message counter and notifications.
* Minimize-to-tray support.
* Performance profiles and background memory management.
* Automatic update checks.
* Windows x64 installer.
* Custom title bar and additional desktop features on top of the VK web interface.

## Architecture

VK Desktop uses Electron and loads the VK web interface inside a `BrowserWindow`.

The application adds its own desktop integration, styles, system tray, Discord RPC, VK Next support, link handling, updates, and other functionality on top of the website.

It is not an independent implementation of the VK interface and is not a fully native client.

## Building from source

Requirements:

* Windows x64
* Node.js 24
* npm 11

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

Main commands:

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm start`         | Run the application                          |
| `npm run check`     | Run linting, tests, and VK Next verification |
| `npm run build:dir` | Create an unpacked Windows x64 build         |
| `npm run build`     | Create an NSIS installer                     |

## Security

The project used standard Electron isolation mechanisms:

* `nodeIntegration: false`
* `contextIsolation: true`
* `sandbox: true`
* restricted IPC
* navigation and external URL filtering
* ASAR integrity verification
* unsafe Electron fuses disabled

Since the project is archived, future changes in Electron, Chromium, VK, or VK Next are no longer tracked. Use older builds with this in mind.

## VK Next

VK Next is a third-party component and is not part of VK Desktop.

All rights to VK Next, VK, their names, logos, services, and other third-party materials belong to their respective owners.

## Disclaimer

VK Desktop is an independent, unofficial project.

It is not affiliated with, endorsed by, or supported by VK. All names, logos, and trademarks belong to their respective owners.
