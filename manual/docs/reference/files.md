# Files and environment

## Where the app keeps things

The app's own folder is `community-lab-ide` in your system's application-data folder:

| System | The app's folder |
|---|---|
| Linux | `~/.config/community-lab-ide` (or `$XDG_CONFIG_HOME/community-lab-ide`) |
| Windows | `%APPDATA%\community-lab-ide` |
| macOS | `~/Library/Application Support/community-lab-ide` |

In it:

| Path | What it holds |
|---|---|
| `data/community.db` | The engine's database: the dialogue cache, and the experiments, Monte Carlo runs and pooled exports it has kept |
| `data/workspace.json` | The workspace you had open, and up to twelve recent ones |
| `logs/server.log` | The engine's log (moved to `server.log.1` when it passes 5 MB) |
| `logs/main.log` | The app's log (on macOS, in `~/Library/Logs/community-lab-ide/` instead) |
| `window.json` | The window's size and position |

**Help › Show Data Folder** and **Help › Show Logs** open them. The settings, the scenario and the API keys are kept
in the window's own storage in the same folder.

**Your workspaces** are wherever you put them. A new sample workspace goes in `Community Lab` in your Documents
folder (or your home folder), then `Community Lab 2` and so on. Inside a workspace, the app writes experiment results
to `results/<title>-<date>/` and exports to `exports/<name>-<date>/`.

**The AppImage's updates** download to `~/.cache/community-lab-ide-updater/`.

Uninstalling leaves all of this in place; delete the app's folder to remove it.

## Environment variables

The desktop app sets the engine's port, address and folders itself. These are for special cases, and for running
the engine from source:

| Variable | Default | What it does |
|---|---|---|
| `COMMUNITY_WORKERS` | half the machine's threads, at most 8 | How many provinces the worker pool runs at once. Each needs a few hundred megabytes while it runs. |
| `OLLAMA_HOST` | `http://localhost:11434` | Where Ollama is. Give it in full, with `http://`. |
| `COMMUNITY_WARM_OLLAMA` | `0` in the desktop app | `1` loads the Ollama model when the engine starts instead of at the first conversation. |
| `COMMUNITY_WORKSPACE` | | A folder to open as the workspace when the engine starts. |
| `COMMUNITY_LAB_DISABLE_UPDATER` | | `1` turns off the AppImage's update check. |
| `PORT`, `HOST` | `3040`, `127.0.0.1` | The engine's port and address, when it runs from source (the desktop app picks a free port from 3040). |
| `COMMUNITY_DATA_DIR` | `./data` | The engine's data folder, when it runs from source. |
| `COMMUNITY_STATIC_DIR` | | A built client for the engine to serve, when it runs from source. |
| `COMMUNITY_API_PORT`, `COMMUNITY_UI_PORT` | `3040`, `5195` | The development pair's ports (`bun run dev`). |

Two more exist for re-checking the mortality calibration from the command line, and change results: see
[Calibration and limits](../model/calibration.md).
