import type { ExportFinished, ExportProgress } from "../types";
import type { Backend, ProbeInfo } from "./api";

/**
 * Stands in for the Rust side when the UI runs in a plain browser, using the
 * clips from `scripts/make-test-clips`. Exports are simulated.
 */
const CLIPS: Record<string, ProbeInfo> = {
  "landscape-720p30.mp4": { duration: 6, width: 1280, height: 720, fps: 30, codec: "h264", hasAudio: true },
  "portrait-24fps.mp4": { duration: 4, width: 720, height: 1280, fps: 24, codec: "h264", hasAudio: true },
  "square-60fps-silent.mp4": { duration: 5, width: 640, height: 640, fps: 60, codec: "h264", hasAudio: false },
};

const urlFor = (path: string) => `/dev-clips/${path.split("/").pop()}`;

let progressHandler: (progress: ExportProgress) => void = () => {};
let finishedHandler: (finished: ExportFinished) => void = () => {};
let timer = 0;

function captureFrames(url: string, duration: number, count: number): Promise<string[]> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    const canvas = document.createElement("canvas");
    const frames: string[] = [];
    const next = () => {
      if (frames.length === count) return resolve(frames);
      video.currentTime = (frames.length + 0.5) * (duration / count);
    };
    video.onloadedmetadata = () => {
      canvas.height = 96;
      canvas.width = Math.round((96 * video.videoWidth) / video.videoHeight);
      next();
    };
    video.onseeked = () => {
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.6));
      next();
    };
    video.onerror = () => resolve([]);
  });
}

export const mockBackend: Backend = {
  async probe(path) {
    const info = CLIPS[path.split("/").pop() ?? ""];
    if (!info) throw new Error(`This file can't be read: ${path}`);
    return info;
  },
  async thumbnails(_id, path, duration) {
    const count = 8;
    return { urls: await captureFrames(urlFor(path), duration, count), interval: duration / count };
  },
  async waveform(path) {
    const info = CLIPS[path.split("/").pop() ?? ""];
    if (!info?.hasAudio) return [];
    return Array.from({ length: Math.ceil(info.duration * 20) }, (_, i) =>
      Math.abs(Math.sin(i / 3) * Math.cos(i / 11)) * 0.8 + 0.1,
    );
  },
  async proxy(_id, path) {
    return urlFor(path);
  },
  async encoders() {
    return ["libx264", "libx265", "libsvtav1", "libvpx-vp9", "h264_videotoolbox", "hevc_videotoolbox"];
  },
  fileUrl: urlFor,
  async pickFiles() {
    return Object.keys(CLIPS).map((name) => `/mock/${name}`);
  },
  async pickOutput(name, format) {
    return `/mock/out/${name}.${format}`;
  },
  async startExport(spec) {
    let fraction = 0;
    timer = window.setInterval(() => {
      fraction += 0.04;
      if (fraction < 1) {
        progressHandler({ stage: "Encoding", fraction });
        return;
      }
      window.clearInterval(timer);
      const tooSmall = spec.maxMb !== null && spec.maxMb < 0.1;
      finishedHandler(
        tooSmall
          ? {
              outcome: null,
              error: { kind: "tooSmall", smallestBytes: 412_000, limitBytes: spec.maxMb! * 1_000_000 },
            }
          : {
              outcome: {
                path: spec.output,
                bytes: (spec.maxMb ?? 18) * 950_000,
                attempts: 1,
                width: spec.width,
                height: spec.height,
              },
              error: null,
            },
      );
    }, 80);
  },
  async cancelExport() {
    window.clearInterval(timer);
    finishedHandler({ outcome: null, error: { kind: "cancelled" } });
  },
  async reveal() {},
  onProgress(handler) {
    progressHandler = handler;
  },
  onFinished(handler) {
    finishedHandler = handler;
  },
  onFileDrop() {},
  // Add ?update to the URL to see an update arrive.
  async downloadUpdate() {
    if (!location.search.includes("update")) return null;
    return {
      version: "9.9.9",
      async install() {
        location.search = "";
      },
    };
  },
  confirm: async (message) => window.confirm(message),
};
