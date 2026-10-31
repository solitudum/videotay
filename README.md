# Videotay

A small desktop video editor for macOS and Windows. Trim, stitch and crop on one magnetic track, then export to MP4, WebM or GIF with the codec you choose and an optional hard size limit.

## Develop

You need Node, Rust and ffmpeg.

```bash
npm install
```

```bash
bash scripts/link-dev-ffmpeg
```

```bash
npx tauri dev
```

`link-dev-ffmpeg` points the app at the ffmpeg on your PATH. That's fine for development, but the result won't run on other machines.

To work on the interface without the app, generate the test clips and run Vite. In a plain browser, a mock backend loads those clips and simulates exports.

```bash
npm run make-test-clips
```

```bash
npm run dev
```

## Test

The Rust tests run real exports, so they need ffmpeg on your PATH and the test clips.

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

## Build for distribution

`fetch-ffmpeg` replaces the development links with static builds, downloaded from [Martin Riedl's builds](https://ffmpeg.martin-riedl.de/) on macOS and [BtbN's builds](https://github.com/BtbN/FFmpeg-Builds) on Windows. Run it on each platform you build for.

```bash
npm run fetch-ffmpeg
```

Updater signatures need the release key, so skip them when you're only building locally.

```bash
npx tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

These ffmpeg builds include x264 and x265, which puts them under the GPL, so see [Licences](#licences) before distributing a build. Builds aren't notarized or code signed, so Gatekeeper and SmartScreen will warn on other machines.

## Release

This sets the version, then commits, tags and pushes to `main`. The tag makes CI test and build for Apple Silicon and Windows x64, and upload the installers to a draft release.

```bash
npm run release -- 0.2.0
```

Nothing reaches anyone until you publish the draft. Publishing is also what makes it the update installed copies see.

```bash
gh release edit v0.2.0 --draft=false
```

The app checks for a new version when it launches, and from "Check for updates" in the command palette. It downloads in the background, then shows "Restart to update" in the header.

Updates are signed with a private key, which CI reads from the `TAURI_SIGNING_PRIVATE_KEY` secret. The matching public key is in `tauri.conf.json`. Keep a backup of `~/.tauri/videotay.key` somewhere safe: installed copies only accept updates signed with that key, so losing it means everyone has to reinstall by hand.

## Install

Download the `.dmg` or `-setup.exe` from [Releases](https://github.com/solitudum/videotay/releases). Because the builds aren't notarized, macOS blocks the first launch: try to open the app, then choose **Open Anyway** in System Settings → Privacy & Security. On Windows, choose **More info → Run anyway**. Move the app to Applications on macOS, because it can't update itself while it's running from the disk image.

## Licences

The app includes ffmpeg and ffprobe as separate programs. They're licensed under the GPL version 3 or later, as [licenses/FFMPEG.txt](licenses/FFMPEG.txt) explains. Both files in `licenses/` go into the app, along with a record of the exact ffmpeg build that `fetch-ffmpeg` downloaded. Each release built by CI also attaches the FFmpeg source for that build.
