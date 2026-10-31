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

```bash
npx tauri build
```

These ffmpeg builds include x264 and x265, which makes them GPL. Distributing the app means complying with the GPL. Builds are unsigned, so Gatekeeper and SmartScreen will warn on other machines.
