# First launch

## What happens when it opens

Community Lab IDE opens on a launch screen (the C₀.₁ mark, *Starting the engine*) while it starts its **engine**:
the simulation server, bundled inside the app, on a port of this machine only (3040, or the next free one up to
3240). When the engine answers, the screen reads *Building Unity Province* and the app opens on the **province**:
the default province, at dawn on its first day, **paused**.

Press <kbd>Space</kbd> (or the play button in the top bar) to start the clock. [Getting started](../getting-started.md)
walks through the first hour from there.

## Where it keeps things

| | Linux | Windows | macOS |
|---|---|---|---|
| Data: the dialogue cache, experiments, Monte Carlo runs and pooled exports kept by the engine, the workspace you had open | `~/.config/community-lab-ide/data` | `%APPDATA%\community-lab-ide\data` | `~/Library/Application Support/community-lab-ide/data` |
| The engine's log (`server.log`) | `~/.config/community-lab-ide/logs` | `%APPDATA%\community-lab-ide\logs` | `~/Library/Application Support/community-lab-ide/logs` |
| The app's log (`main.log`) | the same `logs` folder | the same `logs` folder | `~/Library/Logs/community-lab-ide` |

**Help › Show Data Folder** and **Help › Show Logs** open them. Your workspaces are wherever you put them; the app
only remembers their paths. [Files and environment](../reference/files.md) lists everything in detail.

The window remembers its size and position, and the app remembers your settings, the scenario you built, the view
you were in and the panels you had open. It does not keep the running province: each launch starts the province
afresh on your scenario, at day 0, paused.

## A language model (optional)

The simulation needs no model. To have residents' conversations scripted by one, or to talk to a resident, install
[Ollama](https://ollama.com) and pull a model:

```bash
ollama pull gpt-oss:20b
```

The app finds Ollama at `http://localhost:11434` and picks the first installed model of the gpt-oss, Gemma, Qwen or
Llama families. It loads the model only when the first conversation needs it, so the GPU stays free until then.
If you start Ollama after the app, open **Settings** (the model chip in the top bar) and press **refresh**.
Hosted providers (Anthropic, OpenAI, Gemini, or any OpenAI-compatible endpoint) are set up there too. See
[Conversations](../province/conversations.md).

## If the engine does not start

The launch screen then shows what went wrong in red, with the end of the engine's log beneath it:

| Message | What to do |
|---|---|
| *The engine is missing from this installation* | The installation is incomplete. Reinstall Community Lab IDE. |
| *The engine could not start: …* | The system refused to run it; the message and the log say why. On Linux, check the installation was not copied without its permissions. |
| *The engine stopped … and did not stay up after 3 restarts* | Something in its environment stops it. Read the log (**Help › Show Logs**). |
| *The engine started but did not answer within a minute* | A very slow or busy machine, or something else answering on its port. Quit and start again. |

The launch screen has no retry button: quit the app and start it again. [Troubleshooting](../reference/troubleshooting.md)
has more.

## Updates

The **AppImage** looks for a newer release about fifteen seconds after it starts, downloads one in the background,
and then asks: **Restart now**, or **Later**, in which case the update is installed when you next quit. **Check for
Updates…** (in the Help menu; on a Mac, the app menu) asks at any time.

The **.deb**, **Windows** and **macOS** builds do not update themselves: **Check for Updates…** offers to open the
Releases page, and you install the newer release over the old one.
