# Releasing Community Lab IDE

A release is a GitHub release tagged `community-lab-v<version>` on
[intelligentactuaries/community-lab](https://github.com/intelligentactuaries/community-lab), published (not a draft
or pre-release), carrying the installers. The website's downloads resolve from the release list live, so nothing
on the site needs editing for a new version.

1. **Bump the version** in `package.json` and `desktop/package.json` (they must agree; the workflows check), add
   a `<release>` to `desktop/packaging/io.intelligentactuaries.communitylab.metainfo.xml` (newest first) and an
   entry to `CHANGELOG.md`. If the version's major.minor changed, regenerate the mark and the icons:
   `python3 brand/generate_logo.py --version 0.2 && python3 desktop/scripts/make-icons.py`.
2. **Check**: `bun run typecheck && bun test`, then build and try the Linux installers locally:
   `bun run desktop:install && bun run desktop:dist:linux`. Run the AppImage with
   `COMMUNITY_LAB_DISABLE_UPDATER=1` while the build is unreleased.
3. **Tag and publish** (from an up-to-date `main`):
   ```bash
   git tag community-lab-v0.1.0 && git push origin community-lab-v0.1.0
   gh release create community-lab-v0.1.0 --title "Community Lab IDE 0.1.0" --notes-file notes.md
   ```
4. **Build the installers** on GitHub's runners, each attaching its files to the release:
   ```bash
   gh workflow run release-linux.yml   -f tag=community-lab-v0.1.0   # AppImage, .deb, latest-linux.yml
   gh workflow run release-windows.yml -f tag=community-lab-v0.1.0   # .exe
   gh workflow run release-macos.yml   -f tag=community-lab-v0.1.0   # .dmg (Apple Silicon)
   ```
   Each one smoke-tests the engine inside its package before it uploads, and keeps a screenshot and the logs as a
   workflow artifact. `-f ref=<sha>` builds a later commit of the same version (a platform-only fix).
   The Linux installers may instead be built on a workstation (step 2) and uploaded with
   `gh release upload community-lab-v0.1.0 desktop/build/Community-Lab-IDE-0.1.0-{x86_64.AppImage,x86_64.AppImage.blockmap,amd64.deb} desktop/build/latest-linux.yml`.
   `latest-linux.yml` must name the AppImage exactly as uploaded, which is why the artifact names are hyphenated.
5. **The website**: intelligentactuaries.com/community-lab picks the release up within minutes (it re-resolves
   the release list in the visitor's browser); refresh its baked fallback with `bun run refresh-downloads` in the
   website repository when it is next deployed.

The repository must stay **public**: every installer link resolves into it.
