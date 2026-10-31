import type { Clip } from "../types";

/** Shortest a clip can be on the timeline, in seconds. */
export const MIN_CLIP_SECONDS = 0.05;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const clipDuration = (clip: Clip) => (clip.out - clip.in) / clip.speed;

export const totalDuration = (clips: Clip[]) =>
  clips.reduce((sum, clip) => sum + clipDuration(clip), 0);

/** Timeline start of each clip, plus the end of the last one. */
export function clipEdges(clips: Clip[]): number[] {
  const edges = [0];
  for (const clip of clips) edges.push(edges[edges.length - 1] + clipDuration(clip));
  return edges;
}

export interface Location {
  index: number;
  clip: Clip;
  start: number;
  sourceTime: number;
}

/** Finds the clip under a timeline time. The very end maps to the last clip. */
export function locate(clips: Clip[], time: number): Location | null {
  if (clips.length === 0) return null;
  let start = 0;
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index];
    const duration = clipDuration(clip);
    if (time < start + duration || index === clips.length - 1) {
      const offset = clamp(time - start, 0, duration);
      return { index, clip, start, sourceTime: clip.in + offset * clip.speed };
    }
    start += duration;
  }
  return null;
}

const replace = (clips: Clip[], id: string, patch: (clip: Clip) => Clip) =>
  clips.map((clip) => (clip.id === id ? patch(clip) : clip));

export const trimIn = (clips: Clip[], id: string, value: number) =>
  replace(clips, id, (clip) => ({
    ...clip,
    in: clamp(value, 0, clip.out - MIN_CLIP_SECONDS * clip.speed),
  }));

export const trimOut = (clips: Clip[], id: string, value: number, sourceDuration: number) =>
  replace(clips, id, (clip) => ({
    ...clip,
    out: clamp(value, clip.in + MIN_CLIP_SECONDS * clip.speed, sourceDuration),
  }));

/** Splits the clip under `time`. Does nothing right at a clip's edge. */
export function blade(clips: Clip[], time: number, newId: string): Clip[] {
  const hit = locate(clips, time);
  if (!hit) return clips;
  const { clip, index, start } = hit;
  const offset = time - start;
  if (offset < MIN_CLIP_SECONDS || clipDuration(clip) - offset < MIN_CLIP_SECONDS) return clips;
  const left: Clip = { ...clip, out: hit.sourceTime };
  const right: Clip = { ...clip, id: newId, in: hit.sourceTime };
  return [...clips.slice(0, index), left, right, ...clips.slice(index + 1)];
}

export const removeClip = (clips: Clip[], id: string) => clips.filter((clip) => clip.id !== id);

/** Moves a clip so it ends up at `toIndex` in the resulting list. */
export function moveClip(clips: Clip[], id: string, toIndex: number): Clip[] {
  const from = clips.findIndex((clip) => clip.id === id);
  if (from < 0) return clips;
  const rest = clips.filter((clip) => clip.id !== id);
  const to = clamp(toIndex, 0, rest.length);
  if (to === from) return clips;
  return [...rest.slice(0, to), clips[from], ...rest.slice(to)];
}

export function duplicateClip(clips: Clip[], id: string, newId: string): Clip[] {
  const at = clips.findIndex((clip) => clip.id === id);
  if (at < 0) return clips;
  return [...clips.slice(0, at + 1), { ...clips[at], id: newId }, ...clips.slice(at + 1)];
}

/** Returns the nearest target within tolerance, or the value itself. */
export function snap(value: number, targets: number[], tolerance: number): number {
  let best = value;
  let bestDistance = tolerance;
  for (const target of targets) {
    const distance = Math.abs(target - value);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}
