import type { ExportFinished, ExportProgress, ExportSpec, Format } from "../types";

export interface ProbeInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
}

export interface Backend {
  probe(path: string): Promise<ProbeInfo>;
  thumbnails(id: string, path: string, duration: number): Promise<{ urls: string[]; interval: number }>;
  waveform(path: string): Promise<number[]>;
  proxy(id: string, path: string): Promise<string>;
  encoders(): Promise<string[]>;
  fileUrl(path: string): string;
  pickFiles(): Promise<string[]>;
  pickOutput(name: string, format: Format): Promise<string | null>;
  startExport(spec: ExportSpec): Promise<void>;
  cancelExport(): Promise<void>;
  reveal(path: string): Promise<void>;
  onProgress(handler: (progress: ExportProgress) => void): void;
  onFinished(handler: (finished: ExportFinished) => void): void;
  /** Reports file drags over the window: hover state and dropped paths. */
  onFileDrop(handlers: { hover(on: boolean): void; drop(paths: string[]): void }): void;
}

export const VIDEO_EXTENSIONS = [
  "mp4", "mov", "m4v", "mkv", "webm", "avi", "mts", "m2ts", "ts", "wmv", "flv", "mpg", "mpeg", "3gp", "ogv", "gif",
];
