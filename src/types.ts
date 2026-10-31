export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface Source {
  id: string;
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
  /** What the preview plays: the original, or a proxy if the webview can't. */
  playUrl: string;
  proxying: boolean;
  thumbs: { urls: string[]; interval: number } | null;
  waveform: number[] | null;
}

export interface Clip {
  id: string;
  sourceId: string;
  in: number;
  out: number;
  speed: number;
  crop: Crop | null;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  volume: number;
  muted: boolean;
}

export type Format = "mp4" | "webm" | "gif";
export type Codec = "h264" | "h265" | "av1" | "vp9";

export interface ExportSettings {
  format: Format;
  codec: Codec;
  sizeMode: "quality" | "max";
  crf: number;
  maxMb: number;
  /** Short side in pixels, or the size of the first clip. */
  resolution: "source" | number;
  fps: "source" | number;
  audioKbps: number | null;
  hardware: boolean;
  gifWidth: number;
  gifFps: number;
  gifColors: number;
  gifDither: string;
  gifLoop: boolean;
}

export interface ExportSpec {
  clips: {
    path: string;
    in: number;
    out: number;
    speed: number;
    crop: Crop | null;
    rotate: number;
    flipH: boolean;
    flipV: boolean;
    volume: number;
    muted: boolean;
    srcWidth: number;
    srcHeight: number;
    hasAudio: boolean;
  }[];
  output: string;
  format: Format;
  codec: Codec;
  width: number;
  height: number;
  fps: number;
  crf: number;
  maxMb: number | null;
  audioKbps: number | null;
  hardware: string | null;
  gif: { colors: number; dither: string; loop: boolean };
}

export interface ExportOutcome {
  path: string;
  bytes: number;
  attempts: number;
  width: number;
  height: number;
}

export type ExportFailure =
  | { kind: "cancelled" }
  | { kind: "tooSmall"; smallestBytes: number; limitBytes: number }
  | { kind: "failed"; message: string };

export interface ExportFinished {
  outcome: ExportOutcome | null;
  error: ExportFailure | null;
}

export interface ExportProgress {
  stage: string;
  fraction: number;
}
