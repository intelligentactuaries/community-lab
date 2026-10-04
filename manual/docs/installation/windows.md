# Windows

For Windows 10 or 11 on x64. Download `Community-Lab-IDE-<version>-x64.exe` and run it.

## Installing

The installer first asks who to install for: **Only for me** (the default, which needs no administrator rights and
installs to `%LOCALAPPDATA%\Programs\Community Lab IDE`) or **Anyone who uses this computer**. It then asks where
to install (you may keep the default), and adds Community Lab IDE to the Start menu and a shortcut to the desktop.

### SmartScreen

The installer is not code-signed yet, so Microsoft Defender SmartScreen warns the first time:

1. Click **More info**.
2. Click **Run anyway**.

To check the download first, compare its checksum with the SHA-256 in the release notes. In PowerShell:

```powershell
Get-FileHash .\Community-Lab-IDE-0.1.0-x64.exe -Algorithm SHA256
```

## Updating

Install the newer release over the old one. The Windows build does not update itself: **Help › Check for
Updates…** offers to open the Releases page.

## Uninstalling

**Settings › Apps › Installed apps › Community Lab IDE › Uninstall**. The uninstaller leaves your data: your
workspaces stay wherever you put them, and the app's data and logs stay in `%APPDATA%\community-lab-ide\` until
you delete that folder.
