import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { ExportFinished, ExportProgress } from "../types";
import { VIDEO_EXTENSIONS, type Backend, type ProbeInfo } from "./api";

const FILTER_NAME: Record<string, string> = { mp4: "MP4 video", webm: "WebM video", gif: "GIF" };

export const tauriBackend: Backend = {
  probe: (path) => invoke<ProbeInfo>("probe_media", { path }),
  async thumbnails(id, path, duration) {
    const thumbs = await invoke<{ paths: string[]; interval: number }>("make_thumbnails", {
      id,
      path,
      duration,
    });
    return { urls: thumbs.paths.map((p) => convertFileSrc(p)), interval: thumbs.interval };
  },
  waveform: (path) => invoke<number[]>("make_waveform", { path }),
  async proxy(id, path) {
    return convertFileSrc(await invoke<string>("make_proxy", { id, path }));
  },
  encoders: () => invoke<string[]>("list_encoders"),
  fileUrl: (path) => convertFileSrc(path),
  async pickFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
    });
    return picked ?? [];
  },
  pickOutput: (name, format) =>
    save({
      defaultPath: `${name}.${format}`,
      filters: [{ name: FILTER_NAME[format], extensions: [format] }],
    }),
  startExport: (spec) => invoke("start_export", { spec }),
  cancelExport: () => invoke("cancel_export"),
  reveal: (path) => revealItemInDir(path),
  onProgress(handler) {
    void listen<ExportProgress>("export-progress", (event) => handler(event.payload));
  },
  onFinished(handler) {
    void listen<ExportFinished>("export-finished", (event) => handler(event.payload));
  },
  onFileDrop({ hover, drop }) {
    void getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload;
      if (type === "enter" || type === "over") hover(true);
      else if (type === "leave") hover(false);
      else if (type === "drop") {
        hover(false);
        drop(event.payload.paths);
      }
    });
  },
  async downloadUpdate() {
    // `tauri dev` would otherwise fetch a release to replace a build that isn't installed.
    if (import.meta.env.DEV) return null;
    const update = await check();
    if (!update) return null;
    await update.download();
    return {
      version: update.version,
      async install() {
        await update.install();
        await relaunch();
      },
    };
  },
  confirm: (message) => ask(message, { title: "Videotay", kind: "warning" }),
};
