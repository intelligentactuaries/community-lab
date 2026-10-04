# macOS

For macOS 14 or later on Apple Silicon (M1 and later). There is no build for Intel Macs.

## Installing

Open `Community-Lab-IDE-<version>-arm64.dmg` and drag **Community Lab IDE** into **Applications**.

### The first launch

The app is not notarised yet, so macOS refuses to open it from the Internet the first time. Either clear the
download's quarantine flag once, in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Community Lab IDE.app"
```

or try to open it once, then go to **System Settings › Privacy & Security** and click **Open Anyway**.

To check the download first, compare its checksum with the SHA-256 in the release notes:

```bash
shasum -a 256 Community-Lab-IDE-0.1.0-arm64.dmg
```

## Updating

Replace the app in Applications with the newer release. The macOS build does not update itself: **Community Lab
IDE › Check for Updates…** offers to open the Releases page.

## Uninstalling

Move **Community Lab IDE** from Applications to the Bin. Your workspaces stay wherever you put them; the app's data
and the engine's log are in `~/Library/Application Support/community-lab-ide/`, and the app's own log in
`~/Library/Logs/community-lab-ide/`, until you delete them.
