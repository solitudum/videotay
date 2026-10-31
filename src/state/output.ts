import type { Clip, Codec, ExportSettings, ExportSpec, Format, Source } from "../types";
import { totalDuration } from "./ops";

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

export const RESOLUTION_PRESETS = [2160, 1440, 1080, 720, 480, 360];
export const CODECS_FOR: Record<Format, Codec[]> = {
  mp4: ["h264", "h265", "av1"],
  webm: ["vp9", "av1"],
  gif: [],
};
export const CODEC_LABEL: Record<Codec, string> = {
  h264: "H.264",
  h265: "H.265",
  av1: "AV1",
  vp9: "VP9",
};
export const SOFTWARE_ENCODER: Record<Codec, string> = {
  h264: "libx264",
  h265: "libx265",
  av1: "libsvtav1",
  vp9: "libvpx-vp9",
};
export const DEFAULT_CRF: Record<Codec, number> = { h264: 23, h265: 28, av1: 35, vp9: 33 };
export const MAX_CRF: Record<Codec, number> = { h264: 51, h265: 51, av1: 63, vp9: 63 };

const HARDWARE_ENCODERS: Partial<Record<Codec, string[]>> = {
  h264: ["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf"],
  h265: ["hevc_videotoolbox", "hevc_nvenc", "hevc_qsv", "hevc_amf"],
  av1: ["av1_nvenc"],
};

/** Bits per pixel under which a codec tends to look visibly broken. */
const MIN_BITS_PER_PIXEL: Record<Codec, number> = {
  h264: 0.03,
  h265: 0.02,
  av1: 0.015,
  vp9: 0.02,
};

export function hardwareEncoder(codec: Codec, encoders: string[]): string | null {
  return HARDWARE_ENCODERS[codec]?.find((e) => encoders.includes(e)) ?? null;
}

/** A clip's size after crop and rotation, before scaling to the canvas. */
export function clipSize(clip: Clip, source: Source): { width: number; height: number } {
  const width = clip.crop ? clip.crop.w * source.width : source.width;
  const height = clip.crop ? clip.crop.h * source.height : source.height;
  return clip.rotate % 180 === 0 ? { width, height } : { width: height, height: width };
}

function scaleToShortSide(width: number, height: number, target: "source" | number) {
  const scale = target === "source" ? 1 : Math.min(1, target / Math.min(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

/** Output size follows the first clip, and other clips letterbox into it. */
export function canvasSize(
  clips: Clip[],
  sources: Record<string, Source>,
  settings: Pick<ExportSettings, "format" | "resolution" | "gifWidth">,
): { width: number; height: number } {
  const first = clips[0];
  const source = first && sources[first.sourceId];
  if (!source) return { width: 0, height: 0 };
  const base = clipSize(first, source);
  if (settings.format === "gif") {
    const width = even(Math.min(settings.gifWidth, base.width));
    return { width, height: even((width * base.height) / base.width) };
  }
  return scaleToShortSide(base.width, base.height, settings.resolution);
}

export function outputFps(
  clips: Clip[],
  sources: Record<string, Source>,
  settings: Pick<ExportSettings, "format" | "fps" | "gifFps">,
): number {
  if (settings.format === "gif") return settings.gifFps;
  if (settings.fps !== "source") return settings.fps;
  const rates = clips.map((clip) => sources[clip.sourceId]?.fps ?? 30);
  return Math.min(120, Math.round(Math.max(...rates) * 1000) / 1000 || 30);
}

export function hasOutputAudio(
  clips: Clip[],
  sources: Record<string, Source>,
  settings: Pick<ExportSettings, "format" | "audioKbps">,
): boolean {
  return (
    settings.format !== "gif" &&
    settings.audioKbps !== null &&
    clips.some((clip) => !clip.muted && sources[clip.sourceId]?.hasAudio)
  );
}

export interface SizePlan {
  videoKbps: number;
  tooLow: boolean;
  /** Largest preset short side that gives an acceptable bitrate. */
  suggestedResolution: number | null;
}

/** What a size limit means for bitrate, shown before the export starts. */
export function planForLimit(
  clips: Clip[],
  sources: Record<string, Source>,
  settings: ExportSettings,
): SizePlan | null {
  if (settings.format === "gif" || settings.sizeMode !== "max" || clips.length === 0) return null;
  const duration = totalDuration(clips);
  const audioKbps = hasOutputAudio(clips, sources, settings) ? settings.audioKbps ?? 0 : 0;
  const budget = settings.maxMb * 1_000_000 * 0.97;
  const videoKbps = Math.max(0, Math.round((budget * 8) / duration / 1000 - audioKbps));
  const fps = outputFps(clips, sources, settings);
  const floor = MIN_BITS_PER_PIXEL[settings.codec];
  const fits = (size: { width: number; height: number }) =>
    (videoKbps * 1000) / (size.width * size.height * fps) >= floor;

  const canvas = canvasSize(clips, sources, settings);
  const tooLow = !fits(canvas);
  let suggestedResolution: number | null = null;
  if (tooLow) {
    const short = Math.min(canvas.width, canvas.height);
    suggestedResolution =
      RESOLUTION_PRESETS.find(
        (preset) =>
          preset < short &&
          fits(canvasSize(clips, sources, { ...settings, resolution: preset })),
      ) ?? null;
  }
  return { videoKbps, tooLow, suggestedResolution };
}

export function buildSpec(
  clips: Clip[],
  sources: Record<string, Source>,
  settings: ExportSettings,
  encoders: string[],
  output: string,
): ExportSpec {
  const canvas = canvasSize(clips, sources, settings);
  const limited = settings.sizeMode === "max";
  const hardware =
    settings.hardware && !limited ? hardwareEncoder(settings.codec, encoders) : null;
  return {
    clips: clips.map((clip) => {
      const source = sources[clip.sourceId];
      return {
        path: source.path,
        in: clip.in,
        out: clip.out,
        speed: clip.speed,
        crop: clip.crop,
        rotate: clip.rotate,
        flipH: clip.flipH,
        flipV: clip.flipV,
        volume: clip.volume,
        muted: clip.muted,
        srcWidth: source.width,
        srcHeight: source.height,
        hasAudio: source.hasAudio,
      };
    }),
    output,
    format: settings.format,
    codec: settings.codec,
    width: canvas.width,
    height: canvas.height,
    fps: outputFps(clips, sources, settings),
    crf: settings.crf,
    maxMb: limited ? settings.maxMb : null,
    audioKbps: settings.audioKbps,
    hardware,
    gif: {
      colors: settings.gifColors,
      dither: settings.gifDither,
      loop: settings.gifLoop,
    },
  };
}
