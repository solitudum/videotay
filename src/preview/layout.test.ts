import { describe, expect, it } from "vitest";
import type { Clip, Source } from "../types";
import { centeredCrop, clipLayout, fit, moveCrop, normalizedRatio, resizeCrop } from "./layout";

const source = { width: 1920, height: 1080 } as Source;
const clip = (patch: Partial<Clip> = {}) =>
  ({ crop: null, rotate: 0, flipH: false, flipV: false, ...patch }) as Clip;

describe("fit", () => {
  it("fits by the limiting side", () => {
    expect(fit({ width: 800, height: 800 }, 2)).toEqual({ width: 800, height: 400 });
    expect(fit({ width: 1000, height: 100 }, 2)).toEqual({ width: 200, height: 100 });
  });
});

describe("clip layout", () => {
  it("fills the canvas when the aspect matches", () => {
    const layout = clipLayout(clip(), source, { width: 960, height: 540 });
    expect(layout.frame).toEqual({ width: 960, height: 540 });
    expect(layout.video.left).toBeCloseTo(0);
  });

  it("offsets the video so the crop shows inside the frame", () => {
    const cropped = clip({ crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    const layout = clipLayout(cropped, source, { width: 480, height: 540 });
    expect(layout.frame.width).toBeCloseTo(480);
    expect(layout.video.width).toBeCloseTo(960);
    expect(layout.video.left).toBeCloseTo(-480);
  });

  it("swaps sides when fitting a rotated clip", () => {
    const layout = clipLayout(clip({ rotate: 90 }), source, { width: 540, height: 960 });
    expect(layout.frame.width).toBeCloseTo(960);
    expect(layout.frame.height).toBeCloseTo(540);
  });

  it("flips before rotating, like the export", () => {
    const { transform } = clipLayout(clip({ rotate: 90, flipH: true }), source, {
      width: 540,
      height: 960,
    });
    expect(transform).toBe("rotate(90deg) scale(-1, 1)");
  });
});

describe("crop editing", () => {
  const start = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

  it("drags a free edge", () => {
    expect(resizeCrop(start, "e", 0.1, 0.4, null)).toEqual({ x: 0.25, y: 0.25, w: 0.6, h: 0.5 });
  });

  it("stops at the frame and keeps a minimum size", () => {
    expect(resizeCrop(start, "w", -9, 0, null).x).toBe(0);
    expect(resizeCrop(start, "e", -9, 0, null).w).toBeCloseTo(0.02);
  });

  it("holds the ratio and anchors the opposite corner", () => {
    const resized = resizeCrop(start, "se", 0.1, 0, 2);
    expect(resized.x).toBeCloseTo(0.25);
    expect(resized.y).toBeCloseTo(0.25);
    expect(resized.w / resized.h).toBeCloseTo(2);
  });

  it("shrinks rather than leave the frame when holding a ratio", () => {
    const resized = resizeCrop(start, "se", 9, 9, 1);
    expect(resized.x + resized.w).toBeLessThanOrEqual(1);
    expect(resized.y + resized.h).toBeLessThanOrEqual(1);
    expect(resized.w / resized.h).toBeCloseTo(1);
  });

  it("keeps the crop centered when an edge is dragged with a ratio", () => {
    const resized = resizeCrop(start, "n", 0, 0.1, 1);
    expect(resized.x + resized.w / 2).toBeCloseTo(0.5);
    expect(resized.w / resized.h).toBeCloseTo(1);
  });

  it("moves within the frame", () => {
    expect(moveCrop(start, 9, -9)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });

  it("makes the largest centered crop", () => {
    const square = centeredCrop(normalizedRatio(1, clip(), source));
    expect(square.h).toBe(1);
    expect((square.w * 1920) / (square.h * 1080)).toBeCloseTo(1);
    expect(square.x).toBeCloseTo((1 - square.w) / 2);
  });

  it("inverts the aspect for sideways clips", () => {
    const portrait = normalizedRatio(9 / 16, clip({ rotate: 90 }), source);
    const crop = centeredCrop(portrait);
    expect((crop.w * 1920) / (crop.h * 1080)).toBeCloseTo(16 / 9);
  });
});
