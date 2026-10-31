import { startExport } from "./exporting";
import { pickAndImport } from "./media";
import { useProject } from "./state/project";
import type { ExportSettings, Rotation } from "./types";
import { checkForUpdate } from "./updates";

export interface Command {
  id: string;
  title: string;
  keys?: string;
  run(): void;
  /** Keys that do the same thing but aren't worth showing. */
  aliases?: string[];
  hidden?: boolean;
}

const store = () => useProject.getState();

function changeSelected(patch: (rotate: Rotation) => { rotate: Rotation }) {
  const { selectedId, clips, edit } = store();
  const clip = clips.find((c) => c.id === selectedId);
  if (!clip) return;
  edit((current) => current.map((c) => (c.id === clip.id ? { ...c, ...patch(c.rotate) } : c)));
}

/** Changes export settings from a command, and shows them changing. */
function changeExport(patch: Partial<ExportSettings>) {
  store().updateSettings(patch);
  store().setInspectorTab("export");
}

const ZOOM_STEP = 1.4;

export const COMMANDS: Command[] = [
  { id: "import", title: "Import videos", keys: "mod+O", run: () => void pickAndImport() },
  { id: "export", title: "Export", keys: "mod+E", run: () => void startExport() },
  { id: "play", title: "Play or pause", keys: "Space", run: () => store().togglePlay() },
  { id: "reverse", title: "Play backward", keys: "J", run: () => store().shuttleBy(-1) },
  { id: "stop", title: "Stop", keys: "K", run: () => store().setPlaying(false) },
  { id: "forward", title: "Play forward", keys: "L", run: () => store().shuttleBy(1) },
  { id: "blade", title: "Blade at playhead", keys: "mod+B", run: () => store().bladeAtPlayhead() },
  {
    id: "delete",
    title: "Delete clip",
    keys: "Backspace",
    aliases: ["Delete"],
    run: () => store().deleteSelected(),
  },
  { id: "duplicate", title: "Duplicate clip", keys: "mod+D", run: () => store().duplicateSelected() },
  { id: "in", title: "Trim clip start to playhead", keys: "I", run: () => store().trimInAtPlayhead() },
  { id: "out", title: "Trim clip end to playhead", keys: "O", run: () => store().trimOutAtPlayhead() },
  { id: "undo", title: "Undo", keys: "mod+Z", run: () => store().undo() },
  { id: "redo", title: "Redo", keys: "mod+shift+Z", run: () => store().redo() },
  { id: "crop", title: "Toggle crop", keys: "C", run: () => store().setCropMode(!store().cropMode) },
  {
    id: "rotate",
    title: "Rotate clip right",
    run: () => changeSelected((rotate) => ({ rotate: ((rotate + 90) % 360) as Rotation })),
  },
  {
    id: "zoom-in",
    title: "Zoom in",
    keys: "mod+=",
    aliases: ["mod+shift++"],
    run: () => store().setZoom(store().pxPerSec * ZOOM_STEP),
  },
  {
    id: "zoom-out",
    title: "Zoom out",
    keys: "mod+-",
    run: () => store().setZoom(store().pxPerSec / ZOOM_STEP),
  },
  { id: "fit", title: "Zoom to fit", keys: "shift+Z", run: () => store().zoomToFit() },
  { id: "previous-edit", title: "Previous edit", keys: "Up", run: () => store().jumpEdit(-1) },
  { id: "next-edit", title: "Next edit", keys: "Down", run: () => store().jumpEdit(1) },
  { id: "start", title: "Go to start", keys: "Home", run: () => store().seek(0) },
  { id: "end", title: "Go to end", keys: "End", run: () => store().seek(Infinity) },
  { id: "frame-back", title: "Back one frame", keys: "Left", run: () => store().stepFrames(-1) },
  { id: "frame-forward", title: "Forward one frame", keys: "Right", run: () => store().stepFrames(1) },
  {
    id: "second-back",
    title: "Back ten frames",
    keys: "shift+Left",
    hidden: true,
    run: () => store().stepFrames(-10),
  },
  {
    id: "second-forward",
    title: "Forward ten frames",
    keys: "shift+Right",
    hidden: true,
    run: () => store().stepFrames(10),
  },
  ...[10, 25, 50, 100].map((mb) => ({
    id: `limit-${mb}`,
    title: `Limit export to ${mb} MB`,
    run: () => changeExport({ sizeMode: "max", maxMb: mb }),
  })),
  {
    id: "format-mp4",
    title: "Export as MP4",
    run: () => changeExport({ format: "mp4", codec: "h264", crf: 23 }),
  },
  {
    id: "format-webm",
    title: "Export as WebM",
    run: () => changeExport({ format: "webm", codec: "vp9", crf: 33 }),
  },
  { id: "format-gif", title: "Export as GIF", run: () => changeExport({ format: "gif" }) },
  {
    id: "check-updates",
    title: "Check for updates",
    run: () => void checkForUpdate({ announce: true }),
  },
];

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
};

function eventKeys(event: KeyboardEvent): string {
  const name = KEY_NAMES[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return [event.metaKey || event.ctrlKey ? "mod" : "", event.shiftKey ? "shift" : "", name]
    .filter(Boolean)
    .join("+");
}

/** Text fields keep their keys; sliders and buttons shouldn't swallow shortcuts. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["range", "checkbox"].includes(target.type);
  }
  return target.isContentEditable;
}

export function handleKeyDown(event: KeyboardEvent) {
  const state = store();
  const keys = eventKeys(event);
  if (keys === "mod+K") {
    event.preventDefault();
    state.setPaletteOpen(!state.paletteOpen);
    return;
  }
  if (state.paletteOpen || isTyping(event.target)) return;
  if (keys === "Escape") {
    if (state.cropMode) state.setCropMode(false);
    return;
  }
  if (keys === "Enter" && state.cropMode) {
    // Prevented so that a focused "Done" button doesn't reopen crop straight away.
    event.preventDefault();
    state.setCropMode(false);
    return;
  }
  const command = COMMANDS.find((c) => c.keys === keys || c.aliases?.includes(keys));
  if (!command) return;
  event.preventDefault();
  // A focused button would otherwise also treat Space as a click.
  if (event.target instanceof HTMLElement && event.target.tagName === "BUTTON") event.target.blur();
  command.run();
}
