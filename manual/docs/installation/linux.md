# Linux

Two installers, both for x64: a **.deb** for Ubuntu and Debian, and an **AppImage** for any recent distribution.
Use the .deb where you can. It installs with your package manager, puts Community Lab IDE in your applications, and
carries the AppArmor profile Ubuntu 24.04 needs (below).

## The .deb

For Ubuntu 22.04 or later and Debian 12 or later. Download `Community-Lab-IDE-<version>-amd64.deb` and install it
with `apt`, which also fetches anything it depends on:

```bash
sudo apt install ./Community-Lab-IDE-0.1.0-amd64.deb
```

Start it from your applications (**Community Lab IDE**) or from a terminal:

```bash
community-lab-ide
```

The app installs to `/opt/Community Lab IDE/`.

### The AppArmor profile

The package installs one file outside the app's folder: `/etc/apparmor.d/community-lab-ide`. Ubuntu 24.04 lets a
program use unprivileged user namespaces, which Chromium's sandbox needs, only if an AppArmor profile says so. This
profile says that and nothing else: it leaves the app unconfined. VS Code and other Electron apps install the same
kind of profile. On systems without AppArmor the file is inert.

### Checking the download

Ubuntu's App Center calls a package installed this way "third party". To check the file is the one that was
published, compare its checksum with the SHA-256 in the release notes:

```bash
sha256sum Community-Lab-IDE-0.1.0-amd64.deb
```

### Updating and removing

To update, download the newer .deb and install it the same way; it replaces the old version. To remove it:

```bash
sudo apt remove community-lab-ide     # the app
sudo apt purge community-lab-ide      # the app and the AppArmor profile
```

Neither touches your workspaces or the app's data folder (see [Files and environment](../reference/files.md)).

## The AppImage

For any recent x64 distribution. Make it executable and run it:

```bash
chmod +x Community-Lab-IDE-0.1.0-x86_64.AppImage
./Community-Lab-IDE-0.1.0-x86_64.AppImage
```

### FUSE 2

An AppImage mounts itself with FUSE 2, which Ubuntu 22.04 and later no longer install by default. If it exits with
an error about `libfuse.so.2`:

```bash
sudo apt install libfuse2t64    # Ubuntu 24.04 and later
sudo apt install libfuse2       # Ubuntu 22.04
```

### The sandbox on Ubuntu 24.04

An AppImage cannot install an AppArmor profile, so on Ubuntu 24.04 it may exit with:

```text
The SUID sandbox helper binary was found, but is not configured correctly.
```

Use the .deb instead, which carries the profile, or start the AppImage with `--no-sandbox`.

### Updates

The AppImage updates itself from the Releases page. About fifteen seconds after it starts it checks for a newer
release and downloads it in the background, then asks: **Restart now**, or **Later**, in which case the update is
installed when you next quit. The new release is saved beside the old file under its own name
(`Community-Lab-IDE-<new version>-x86_64.AppImage`). To turn the check off, start the AppImage with the environment
variable `COMMUNITY_LAB_DISABLE_UPDATER=1`.

The .deb does not update itself: **Help › Check for Updates…** offers to open the Releases page.

## Uninstalling

The .deb as above. The AppImage is a single file: delete it. Your workspaces stay wherever you put them, and the
app's data and logs stay in `~/.config/community-lab-ide/` until you delete that folder.
