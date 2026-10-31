import { describe, expect, it } from "vitest";
import type { Clip, ExportSettings, Source } from "../types";
import { buildSpec, canvasSize, hardwareEncoder, outputFps, planForLimit } from "./output";

const source: Source = {
  id: "s",
  path: "/a.mp4",
  name: "a.mp4",
  duration: 60,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "h264",
  hasAudio: true,
  playUrl: "",
  proxying: false,
  thumbs: null,
  waveform: null,
};
const sources = { s: source };

const clip = (patch: Partial<Clip> = {}): Clip => ({
  id: "c",
  sourceId: "s",
  in: 0,
  out: 60,
  speed: 1,
  crop: null,
  rotate: 0,
  flipH: false,
  flipV: false,
  volume: 1,
  muted: false,
  ...patch,
});

const settings = (patch: Partial<ExportSettings> = {}): ExportSettings => ({
  format: "mp4",
  codec: "h264",
  sizeMode: "max",
  crf: 23,
  maxMb: 10,
  resolution: "source",
  fps: "source",
  audioKbps: 128,
  hardware: false,
  gifWidth: 480,
  gifFps: 15,
  gifColors: 128,
  gifDither: "bayer",
  gifLoop: true,
  ...patch,
});

describe("canvas", () => {
  it("follows the first clip's crop and rotation", () => {
    const cropped = clip({ crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    expect(canvasSize([cropped], sources, settings())).toEqual({ width: 960, height: 1080 });
    const rotated = clip({ rotate: 90 });
    expect(canvasSize([rotated], sources, settings())).toEqual({ width: 1080, height: 1920 });
  });

  it("scales the short side and never upscales", () => {
    const portrait = clip({ rotate: 270 });
    expect(canvasSize([portrait], sources, settings({ resolution: 720 }))).toEqual({
      width: 720,
      height: 1280,
    });
    expect(canvasSize([clip()], sources, settings({ resolution: 2160 }))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("keeps dimensions even", () => {
    const odd = clip({ crop: { x: 0, y: 0, w: 0.3333, h: 0.3333 } });
    const { width, height } = canvasSize([odd], sources, settings());
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
  });

  it("uses the GIF width for GIFs, capped at the clip's width", () => {
    const gif = settings({ format: "gif", gifWidth: 480 });
    expect(canvasSize([clip()], sources, gif)).toEqual({ width: 480, height: 270 });
    const wide = settings({ format: "gif", gifWidth: 4000 });
    expect(canvasSize([clip()], sources, wide).width).toBe(1920);
  });
});

describe("fps", () => {
  it("uses the fastest source by default", () => {
    const fast = { ...source, id: "f", fps: 59.94 };
    const clips = [clip(), clip({ id: "d", sourceId: "f" })];
    expect(outputFps(clips, { ...sources, f: fast }, settings())).toBe(59.94);
  });

  it("uses the GIF rate for GIFs", () => {
    expect(outputFps([clip()], sources, settings({ format: "gif", gifFps: 12 }))).toBe(12);
  });
});

describe("size limit plan", () => {
  it("subtracts audio and margin", () => {
    expect(planForLimit([clip()], sources, settings())?.videoKbps).toBe(1165);
  });

  it("ignores audio when every clip is muted", () => {
    const plan = planForLimit([clip({ muted: true })], sources, settings());
    expect(plan?.videoKbps).toBe(1293);
  });

  it("warns and suggests a lower resolution when bitrate is too low", () => {
    const plan = planForLimit([clip()], sources, settings());
    expect(plan?.tooLow).toBe(true);
    expect(plan?.suggestedResolution).toBe(720);
  });

  it("doesn't warn when there's plenty of room", () => {
    const plan = planForLimit([clip()], sources, settings({ maxMb: 100 }));
    expect(plan?.tooLow).toBe(false);
    expect(plan?.suggestedResolution).toBeNull();
  });

  it("doesn't apply in quality mode or to GIFs", () => {
    expect(planForLimit([clip()], sources, settings({ sizeMode: "quality" }))).toBeNull();
    expect(planForLimit([clip()], sources, settings({ format: "gif" }))).toBeNull();
  });
});

describe("spec", () => {
  it("never sends hardware encoders with a size limit", () => {
    const encoders = ["libx264", "h264_videotoolbox"];
    const limited = buildSpec([clip()], sources, settings({ hardware: true }), encoders, "/o.mp4");
    expect(limited.hardware).toBeNull();
    const quality = buildSpec(
      [clip()],
      sources,
      settings({ hardware: true, sizeMode: "quality" }),
      encoders,
      "/o.mp4",
    );
    expect(quality.hardware).toBe("h264_videotoolbox");
    expect(quality.maxMb).toBeNull();
  });

  it("finds a working hardware encoder per codec", () => {
    expect(hardwareEncoder("h265", ["hevc_nvenc"])).toBe("hevc_nvenc");
    expect(hardwareEncoder("vp9", ["hevc_nvenc"])).toBeNull();
  });
});
