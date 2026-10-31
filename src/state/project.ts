import { create } from "zustand";
import type {
  Clip,
  ExportFailure,
  ExportOutcome,
  ExportSettings,
  Source,
} from "../types";
import * as ops from "./ops";

const MAX_HISTORY = 200;
let counter = 0;
export const nextId = (prefix: string) => `${prefix}${++counter}`;

export type ExportRun =
  | { status: "idle" }
  | { status: "running"; stage: string; fraction: number }
  | { status: "done"; outcome: ExportOutcome }
  | { status: "failed"; error: Exclude<ExportFailure, { kind: "cancelled" }> };

export type InspectorTab = "clip" | "export";

export interface ProjectState {
  sources: Record<string, Source>;
  clips: Clip[];
  past: Clip[][];
  future: Clip[][];
  selectedId: string | null;
  playhead: number;
  playing: boolean;
  /** Playback direction and multiplier: 1, 2, 4, or -1, -2, -4. */
  shuttle: number;
  cropMode: boolean;
  /** How crop's aspect preset is constrained, as output width over height. */
  cropAspect: number | null;
  pxPerSec: number;
  fit: boolean;
  importing: number;
  notice: string | null;
  paletteOpen: boolean;
  inspectorTab: InspectorTab;
  encoders: string[];
  settings: ExportSettings;
  run: ExportRun;

  checkpoint(): void;
  /** Edits without an undo step, for use during a drag after `checkpoint`. */
  setClips(clips: Clip[]): void;
  /** Edits as one undo step. */
  edit(update: (clips: Clip[]) => Clip[]): void;
  updateClip(id: string, patch: Partial<Clip>): void;
  undo(): void;
  redo(): void;

  addSource(source: Source): void;
  patchSource(id: string, patch: Partial<Source>): void;
  appendClip(source: Source): void;

  select(id: string | null): void;
  seek(time: number): void;
  setPlaying(playing: boolean): void;
  togglePlay(): void;
  shuttleBy(direction: 1 | -1): void;
  stepFrames(count: number): void;
  jumpEdit(direction: 1 | -1): void;

  bladeAtPlayhead(): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  trimInAtPlayhead(): void;
  trimOutAtPlayhead(): void;

  setCropMode(on: boolean): void;
  setZoom(pxPerSec: number): void;
  zoomToFit(): void;
  setImporting(delta: number): void;
  notify(message: string | null): void;
  setPaletteOpen(open: boolean): void;
  setInspectorTab(tab: InspectorTab): void;
  setEncoders(encoders: string[]): void;
  updateSettings(patch: Partial<ExportSettings>): void;
  setRun(run: ExportRun): void;
}

export const useProject = create<ProjectState>((set, get) => {
  /** Keeps the playhead and selection valid after any change to the clips. */
  const withClips = (clips: Clip[]) => {
    const { selectedId, playhead } = get();
    const stillThere = clips.some((clip) => clip.id === selectedId);
    return {
      clips,
      selectedId: stillThere ? selectedId : null,
      playhead: Math.min(playhead, ops.totalDuration(clips)),
    };
  };

  const clipUnderPlayhead = () => {
    const { clips, playhead } = get();
    return ops.locate(clips, playhead);
  };

  return {
    sources: {},
    clips: [],
    past: [],
    future: [],
    selectedId: null,
    playhead: 0,
    playing: false,
    shuttle: 1,
    cropMode: false,
    cropAspect: null,
    pxPerSec: 40,
    fit: true,
    importing: 0,
    notice: null,
    paletteOpen: false,
    inspectorTab: "clip",
    encoders: [],
    settings: {
      format: "mp4",
      codec: "h264",
      sizeMode: "quality",
      crf: 23,
      maxMb: 25,
      resolution: "source",
      fps: "source",
      audioKbps: 128,
      hardware: false,
      gifWidth: 480,
      gifFps: 15,
      gifColors: 128,
      gifDither: "sierra2_4a",
      gifLoop: true,
    },
    run: { status: "idle" },

    checkpoint() {
      const { clips, past } = get();
      set({ past: [...past, clips].slice(-MAX_HISTORY), future: [] });
    },
    setClips(clips) {
      set(withClips(clips));
    },
    edit(update) {
      const { clips } = get();
      const next = update(clips);
      if (next === clips) return;
      get().checkpoint();
      set(withClips(next));
    },
    updateClip(id, patch) {
      get().setClips(get().clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)));
    },
    undo() {
      const { past, clips, future } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({ past: past.slice(0, -1), future: [clips, ...future], playing: false });
      set(withClips(previous));
    },
    redo() {
      const { past, clips, future } = get();
      const next = future[0];
      if (!next) return;
      set({ past: [...past, clips], future: future.slice(1), playing: false });
      set(withClips(next));
    },

    addSource(source) {
      set((state) => ({ sources: { ...state.sources, [source.id]: source } }));
    },
    patchSource(id, patch) {
      set((state) => ({
        sources: { ...state.sources, [id]: { ...state.sources[id], ...patch } },
      }));
    },
    appendClip(source) {
      const clip: Clip = {
        id: nextId("c"),
        sourceId: source.id,
        in: 0,
        out: source.duration,
        speed: 1,
        crop: null,
        rotate: 0,
        flipH: false,
        flipV: false,
        volume: 1,
        muted: false,
      };
      get().edit((clips) => [...clips, clip]);
      if (!get().selectedId) set({ selectedId: clip.id });
      if (get().fit) get().zoomToFit();
    },

    select(id) {
      set({ selectedId: id, cropMode: false, cropAspect: null });
    },
    seek(time) {
      const end = ops.totalDuration(get().clips);
      set({ playhead: Math.max(0, Math.min(time, end)), playing: false, shuttle: 1 });
    },
    setPlaying(playing) {
      if (get().clips.length === 0) return;
      set({ playing, shuttle: 1, cropMode: playing ? false : get().cropMode });
    },
    togglePlay() {
      get().setPlaying(!get().playing);
    },
    shuttleBy(direction) {
      const { playing, shuttle, clips } = get();
      if (clips.length === 0) return;
      const sameWay = playing && Math.sign(shuttle) === direction;
      const size = sameWay ? Math.min(Math.abs(shuttle) * 2, 4) : 1;
      set({ playing: true, shuttle: size * direction, cropMode: false });
    },
    stepFrames(count) {
      const hit = clipUnderPlayhead();
      if (!hit) return;
      const fps = get().sources[hit.clip.sourceId]?.fps ?? 30;
      get().seek(get().playhead + count / fps);
    },
    jumpEdit(direction) {
      const { clips, playhead } = get();
      const edges = ops.clipEdges(clips);
      const target =
        direction > 0
          ? edges.find((edge) => edge > playhead + 1e-3)
          : [...edges].reverse().find((edge) => edge < playhead - 1e-3);
      if (target !== undefined) get().seek(target);
    },

    bladeAtPlayhead() {
      const newId = nextId("c");
      get().edit((clips) => ops.blade(clips, get().playhead, newId));
    },
    deleteSelected() {
      const { selectedId, clips } = get();
      if (!selectedId) return;
      const index = clips.findIndex((clip) => clip.id === selectedId);
      get().edit((current) => ops.removeClip(current, selectedId));
      const remaining = get().clips;
      set({
        selectedId: remaining[Math.min(index, remaining.length - 1)]?.id ?? null,
        cropMode: false,
      });
    },
    duplicateSelected() {
      const { selectedId } = get();
      if (!selectedId) return;
      const newId = nextId("c");
      get().edit((clips) => ops.duplicateClip(clips, selectedId, newId));
      set({ selectedId: newId });
    },
    trimInAtPlayhead() {
      const hit = clipUnderPlayhead();
      if (hit) get().edit((clips) => ops.trimIn(clips, hit.clip.id, hit.sourceTime));
    },
    trimOutAtPlayhead() {
      const hit = clipUnderPlayhead();
      if (!hit) return;
      const duration = get().sources[hit.clip.sourceId]?.duration ?? hit.clip.out;
      get().edit((clips) => ops.trimOut(clips, hit.clip.id, hit.sourceTime, duration));
    },

    setCropMode(on) {
      const { clips, selectedId } = get();
      const clipId = selectedId ?? ops.locate(clips, get().playhead)?.clip.id ?? null;
      if (!on || !clipId) {
        set({ cropMode: false, cropAspect: null });
        return;
      }
      // Crop works on one clip, so the preview has to be showing that clip.
      const index = clips.findIndex((clip) => clip.id === clipId);
      const edges = ops.clipEdges(clips);
      const inside = get().playhead >= edges[index] && get().playhead < edges[index + 1];
      set({
        selectedId: clipId,
        cropMode: true,
        inspectorTab: "clip",
        playing: false,
        playhead: inside ? get().playhead : edges[index],
      });
    },
    setZoom(pxPerSec) {
      set({ pxPerSec: Math.max(1, Math.min(pxPerSec, 800)), fit: false });
    },
    zoomToFit() {
      set({ fit: true });
    },
    setImporting(delta) {
      set((state) => ({ importing: state.importing + delta }));
    },
    notify(notice) {
      set({ notice });
    },
    setPaletteOpen(paletteOpen) {
      set({ paletteOpen });
    },
    setInspectorTab(inspectorTab) {
      set({ inspectorTab });
    },
    setEncoders(encoders) {
      set({ encoders });
    },
    updateSettings(patch) {
      set((state) => ({ settings: { ...state.settings, ...patch } }));
    },
    setRun(run) {
      set({ run });
    },
  };
});
