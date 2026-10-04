# Installation

Community Lab IDE installs like any desktop application. Each installer carries the whole of it: the desktop
shell, the engine (a compiled server with its worker pool) and the client, with the 3D people built in. It needs
no account and no network: the only things that go online are the AppImage's update check and a hosted language
model, if you choose one.

## Pick your installer

The installers are on the [Releases page](https://github.com/intelligentactuaries/community-lab/releases) and at
[intelligentactuaries.com/community-lab](https://intelligentactuaries.com/community-lab), which always links each
platform's newest build.

| Platform | Installer | Guide |
|---|---|---|
| Ubuntu 22.04 or later, Debian 12 or later (x64) | `Community-Lab-IDE-<version>-amd64.deb` | [Linux](linux.md#the-deb) |
| Any recent Linux (x64) | `Community-Lab-IDE-<version>-x86_64.AppImage` | [Linux](linux.md#the-appimage) |
| Windows 10 or 11 (x64) | `Community-Lab-IDE-<version>-x64.exe` | [Windows](windows.md) |
| macOS 14 or later, Apple Silicon | `Community-Lab-IDE-<version>-arm64.dmg` | [macOS](macos.md) |

!!! note "Not signed yet"
    The Windows installer is not code-signed and the macOS app is not notarised yet, so each system warns the first
    time you open it. The platform guides say how to get past the warning. Each release lists the SHA-256 of every
    installer, so you can check a download before you trust it.

## What it needs

| | |
|---|---|
| Processor and system | 64-bit: x64 on Linux and Windows, Apple Silicon on macOS |
| Memory | 8 GB; 16 GB for long experiments on many workers |
| Disk | About 600 MB |
| Graphics | A GPU with WebGL 2 for the [3D close-up](../province/3d.md). The map, the analytics and the workbench work without one. |
| Network | None. The engine listens on a port of this machine only (3040, or the next free one) and answers requests addressed to this machine alone. |

## A model for the conversations (optional)

The simulation needs no language model. Residents' conversations are written procedurally unless you ask a model
to script them, and talking to a resident needs one. By default that is a local model through
[Ollama](https://ollama.com):

```bash
ollama pull gpt-oss:20b
```

Any other Ollama model works, and so do hosted providers. See [Conversations](../province/conversations.md) for
how the model is used and [Settings](../reference/settings.md) for choosing one.

## Next

Install for your platform, then read [First launch](first-launch.md) for what happens when the app opens.
