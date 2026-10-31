import type { Backend } from "./api";

export { VIDEO_EXTENSIONS } from "./api";

const inTauri = "__TAURI_INTERNALS__" in window;

// The browser version only exists so the UI can be developed without the app.
// Neither implementation may import this file: this await would wait on them
// while they wait on it, and the app would hang on a blank page with no error.
export const backend: Backend = inTauri
  ? (await import("./tauri")).tauriBackend
  : (await import("./mock")).mockBackend;
