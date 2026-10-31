import type { Clip, Crop, Source } from "../types";

export interface Box {
  width: number;
  height: number;
}

/** Largest box of the given aspect ratio that fits inside `outer`. */
export function fit(outer: Box, aspect: number): Box {
  if (outer.width <= 0 || outer.height <= 0 || !aspect) return { width: 0, height: 0 };
  return outer.width / outer.height > aspect
    ? { width: outer.height * aspect, height: outer.height }
    : { width: outer.width, height: outer.width / aspect };
}

export interface ClipLayout {
  /** The cropped region, centered in the canvas, before rotation. */
  frame: Box;
  /** The whole video element, positioned inside the frame. */
  video: Box & { left: number; top: number };
  transform: string;
}

/** Mirrors the export: crop, flip, rotate, then scale to fit the canvas. */
export function clipLayout(clip: Clip, source: Source, canvas: Box): ClipLayout {
  const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const cropWidth = crop.w * source.width;
  const cropHeight = crop.h * source.height;
  const sideways = clip.rotate % 180 !== 0;
  const shownWidth = sideways ? cropHeight : cropWidth;
  const shownHeight = sideways ? cropWidth : cropHeight;
  const scale = Math.min(canvas.width / shownWidth, canvas.height / shownHeight);
  return {
    frame: { width: cropWidth * scale, height: cropHeight * scale },
    video: {
      width: source.width * scale,
      height: source.height * scale,
      left: -crop.x * source.width * scale,
      top: -crop.y * source.height * scale,
    },
    transform: `rotate(${clip.rotate}deg) scale(${clip.flipH ? -1 : 1}, ${clip.flipV ? -1 : 1})`,
  };
}

export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_CROP = 0.02;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Resizes a normalized crop. `ratio` is width over height in normalized units;
 * with one set, the handle opposite the one dragged stays anchored.
 */
export function resizeCrop(
  start: Crop,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
): Crop {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  if (ratio === null) return { x: left, y: top, w: right - left, h: bottom - top };

  const dirX = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const dirY = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  const anchorX = dirX > 0 ? left : dirX < 0 ? right : start.x + start.w / 2;
  const anchorY = dirY > 0 ? top : dirY < 0 ? bottom : start.y + start.h / 2;
  const room = (anchor: number, dir: number) =>
    dir > 0 ? 1 - anchor : dir < 0 ? anchor : 2 * Math.min(anchor, 1 - anchor);

  let width = right - left;
  let height = bottom - top;
  if (dirX !== 0) height = width / ratio;
  else width = height * ratio;
  const shrink = Math.min(1, room(anchorX, dirX) / width, room(anchorY, dirY) / height);
  width *= shrink;
  height *= shrink;

  const place = (anchor: number, dir: number, size: number) =>
    dir > 0 ? anchor : dir < 0 ? anchor - size : anchor - size / 2;
  return { x: place(anchorX, dirX, width), y: place(anchorY, dirY, height), w: width, h: height };
}

export function moveCrop(start: Crop, dx: number, dy: number): Crop {
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.w),
    y: clamp(start.y + dy, 0, 1 - start.h),
  };
}

/** Largest crop with a normalized ratio, centered in the frame. */
export function centeredCrop(ratio: number): Crop {
  const w = ratio >= 1 ? 1 : ratio;
  const h = ratio >= 1 ? 1 / ratio : 1;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Converts an output aspect to crop space, which rotation turns sideways. */
export function normalizedRatio(aspect: number, clip: Clip, source: Source): number {
  const pixels = clip.rotate % 180 === 0 ? aspect : 1 / aspect;
  return (pixels * source.height) / source.width;
}
