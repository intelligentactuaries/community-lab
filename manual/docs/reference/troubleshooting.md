# Troubleshooting

## Installing and starting

??? question "The AppImage exits at once, mentioning `libfuse.so.2`"
    It needs FUSE 2, which Ubuntu 22.04 and later do not install by default:
    `sudo apt install libfuse2t64` (24.04 and later) or `sudo apt install libfuse2` (22.04).

??? question "On Ubuntu 24.04 the AppImage exits: *The SUID sandbox helper binary was found, but is not configured correctly*"
    Ubuntu 24.04 lets a program use the user namespaces Chromium's sandbox needs only if an AppArmor profile says
    so, and an AppImage cannot install one. Use the **.deb**, which installs the profile, or start the AppImage with
    `--no-sandbox`.

??? question "Windows says *Windows protected your PC*"
    The installer is not code-signed yet. Click **More info**, then **Run anyway**. Check the file's SHA-256 against
    the release notes first if you like.

??? question "macOS says the app *cannot be opened* or *is damaged*"
    It is not notarised yet. Run `xattr -dr com.apple.quarantine "/Applications/Community Lab IDE.app"` once, or
    use **System Settings › Privacy & Security › Open Anyway**. There is no build for Intel Macs.

??? question "The launch screen shows a red message"
    The engine did not start. The message says why and the end of its log is beneath it; **Help › Show Logs** has
    the whole of it. See [First launch](../installation/first-launch.md#if-the-engine-does-not-start). There is no
    retry button: quit and start the app again. If it persists, reinstall.

??? question "The app was already open, and launching it again did nothing"
    Only one copy runs at a time; a second launch brings the first window to the front.

??? question "The window shows *Community Lab stopped*"
    Something in the page failed. The message and the start of its trace are on the screen; **Reload Community Lab**
    starts the page again. If it comes back, report it with the logs (see [Getting help](#getting-help)).

??? question "The engine's address answers *this server answers on localhost, 127.0.0.1 or [::1] only*"
    The engine serves this machine only, the page as well as the API. Open it as `localhost` or `127.0.0.1` on the
    machine it runs on; another computer, or another name for this one, is refused.

## The province

??? question "Nothing moves"
    The province starts paused. Press <kbd>Space</kbd>.

??? question "People are not walking, or there are no conversations"
    At speeds above an hour a second the province is a time-lapse: people are shown where their plan puts them, and
    conversations and intruders happen only in the animated day. Press <kbd>5</kbd> or slower.

??? question "The speed shown in the corner is lower than the speed I chose"
    The corner shows the speed actually achieved. At a year a second a slow machine may fall short; the simulation
    is the same, it just takes longer.

??? question "The 3D close-up never appears"
    Check the **3D** button in the zoom column is on. The close-up needs WebGL 2; on a machine without it the map
    stays flat (the developer tools' console says *3D view unavailable*). The first time, the 3D people take a moment
    to load.

??? question "The 3D close-up stutters"
    It draws the 140 nearest people at full detail near the camera. A local language model and the close-up compete
    for the GPU's memory: a 20b model holds about 7 GB once a conversation has loaded it. Close other GPU-heavy
    programs, or choose a smaller model.

??? question "My province is gone after restarting the app"
    The app keeps the basis you built, and the world you ran from the builder, not the running simulation: each
    launch starts it afresh at day 0, on the same seed and basis, so the same history follows. To keep a scenario,
    save it as a province file (**File › New › The Province on Screen, as a File**). A built world that is too large
    for the app's storage, or that no longer runs, is not kept: the built-in province starts instead, and the world
    is still in its `.sce` file if you saved it.

## The Community Builder

??? question "**Run this world** does nothing but open the Checks"
    Something stops the world from running: the checks under *Stops the world from running* say what. Click one to
    fly to it. The usual ones are a door more than 60 m from a road (run a road past it), roads that do not join the
    rest, and two buildings overlapping.

??? question "A building will not go down where I click"
    It would overlap another building or stand partly off the map; the notice on the board says which.
    Move it a little, or hold <kbd>Alt</kbd> to place it without its door snapping to the road.

??? question "*Not saved: … The draft is kept in this browser*"
    The engine could not write the world's file. Nothing is lost: the builder keeps a draft of the world on this
    machine and opens on it next time. Save again, or **Download .sce** to keep a copy elsewhere.

??? question "*Could not open … this .sce is a Scelo project … not a Community Lab world*"
    The file was saved by Scelo: a dataset and its analysis, not a world. Open it in Scelo. A file whose world is
    *not a community-lab.world/1 world* may come from a newer Community Lab.

## Conversations and models

??? question "The model chip says *no model*"
    No provider is available. Start [Ollama](https://ollama.com) and pull a model (`ollama pull gpt-oss:20b`), then
    open **Settings** and press **refresh** (the app looks for Ollama when it starts, and again when you ask); or add
    a key for a hosted provider and press **save**.

??? question "A conversation says *model failed — showing chatter*"
    The model could not be reached or did not answer; the map's corner shows the reason. The conversation carries on
    with procedural lines. The engine runs at most two conversations at a time through a model; try again in a
    moment.

??? question "Ollama runs on another machine or port"
    Set `OLLAMA_HOST` (with `http://`) in the environment the app starts from, for instance
    `OLLAMA_HOST=http://192.168.1.20:11434`.

## The workbench

??? question "*… changed on disk since it was opened*"
    Another program changed the file after you opened it. **Reload from disk** takes theirs; **Keep mine and
    overwrite** saves yours over it.

??? question "A basis value was *left out*"
    The engine does not take that value (an unknown name, or a value outside the range a file may set); the rest of
    the file was applied. [Basis parameters](basis.md) lists every name and range.

??? question "An experiment is refused: *… province-years … at most 800*"
    Seeds × years × (arms + 1) must be 800 or less. Use fewer seeds, fewer years or fewer arms.

??? question "My unsaved edits disappeared when I opened another folder"
    Opening a different workspace replaces the open tabs without asking. Save first (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>).

## Getting help

**Help › Report an Issue** opens the project's issue tracker. Reports you would rather keep private go to
**bugs@scelo.ai**; security issues, as `SECURITY.md` in the repository says. Include the version (**Help › About**,
or the app menu on a Mac) and the logs (**Help › Show Logs**).
