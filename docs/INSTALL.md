# Installing Community Lab IDE

The installers are on the [Releases tab](https://github.com/intelligentactuaries/community-lab/releases) and at
[intelligentactuaries.com/community-lab](https://intelligentactuaries.com/community-lab). Each carries the whole
application: the desktop shell, the engine (a compiled Bun server and its worker pool) and the client. Nothing is
downloaded when it runs.

## Linux

**The .deb** (Ubuntu 22.04 and later, Debian 12 and later, x64):

```bash
sudo apt install ./Community-Lab-IDE-0.1.0-amd64.deb
```

`apt` pulls in what it needs. Ubuntu's App Center calls a package installed this way "third party"; check it
against the SHA-256 in the release notes if you want to verify it. Remove it with
`sudo apt remove community-lab-ide`.

**The AppImage** (any recent x64 distribution):

```bash
chmod +x Community-Lab-IDE-0.1.0-x86_64.AppImage
./Community-Lab-IDE-0.1.0-x86_64.AppImage
```

It needs FUSE 2, which Ubuntu 22.04 and later no longer install by default: if it exits with a `libfuse.so.2`
error, `sudo apt install libfuse2t64` (`libfuse2` before 24.04). The AppImage updates itself from the Releases tab:
it checks a little after it starts and asks before restarting.

## Windows

Run `Community-Lab-IDE-0.1.0-x64.exe` (Windows 10 or 11, x64). It installs for your user, with a Start menu and a
desktop shortcut, and you may choose the folder. The installer is not code-signed yet, so SmartScreen warns on
first launch: **More info → Run anyway**. Uninstall it from Settings › Apps. To update, install the newer release
over it.

## macOS

Open `Community-Lab-IDE-0.1.0-arm64.dmg` and drag Community Lab IDE into Applications (macOS 14 or later, Apple
Silicon; there is no Intel build). The app is not notarised yet, so clear the download's quarantine flag once:

```bash
xattr -dr com.apple.quarantine "/Applications/Community Lab IDE.app"
```

or allow it under System Settings › Privacy & Security › **Open Anyway** after the first attempt. To update,
replace the app with the newer release.

## A model for the conversations (optional)

The simulation needs no model. Conversations between residents, and talking to one, are scripted by a model:
by default a local one through [Ollama](https://ollama.com):

```bash
ollama pull gpt-oss:20b
```

Any other Ollama model works, and so does a hosted provider (Anthropic, OpenAI, Gemini, or any OpenAI-compatible
endpoint): choose it in Settings (the model chip in the top bar). Keys are held in memory by the engine and never
written to disk. The IDE loads the local model on the first conversation, not at start: a 20b model holds about
7 GB of a GPU's memory, which the 3D close-up also wants.

## Where things are

| | Linux | Windows | macOS |
|---|---|---|---|
| Data (the dialogue cache, kept experiments and exports, the workspace you had open) | `~/.config/community-lab-ide/data` | `%APPDATA%\community-lab-ide\data` | `~/Library/Application Support/community-lab-ide/data` |
| Logs (`main.log`, `server.log`) | `~/.config/community-lab-ide/logs` | `%APPDATA%\community-lab-ide\logs` | `~/Library/Logs/community-lab-ide` and the data folder's `logs` |

*Help › Show Logs* and *Help › Show Data Folder* open them. Your workspaces are wherever you put them; the IDE
only remembers their paths.

## Requirements

A 64-bit machine with 8 GB of memory (16 GB for long experiments on many workers), about 600 MB of disk, and a GPU
with WebGL 2 for the 3D close-up (the map and everything else work without one). The engine listens on a loopback
port (3040, or the next free one) and answers only this machine.
