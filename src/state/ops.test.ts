import { describe, expect, it } from "vitest";
import type { Clip } from "../types";
import {
  blade,
  clipDuration,
  clipEdges,
  duplicateClip,
  locate,
  moveClip,
  removeClip,
  snap,
  totalDuration,
  trimIn,
  trimOut,
} from "./ops";

const clip = (id: string, inPoint: number, out: number, speed = 1): Clip => ({
  id,
  sourceId: "s",
  in: inPoint,
  out,
  speed,
  crop: null,
  rotate: 0,
  flipH: false,
  flipV: false,
  volume: 1,
  muted: false,
});

const three = () => [clip("a", 0, 4), clip("b", 2, 4), clip("c", 0, 6, 2)];
const ids = (clips: Clip[]) => clips.map((c) => c.id).join("");

describe("timing", () => {
  it("accounts for speed", () => {
    expect(clipDuration(clip("x", 0, 6, 2))).toBe(3);
    expect(totalDuration(three())).toBe(9);
    expect(clipEdges(three())).toEqual([0, 4, 6, 9]);
  });

  it("locates clips and maps to source time", () => {
    const hit = locate(three(), 5);
    expect(hit?.clip.id).toBe("b");
    expect(hit?.sourceTime).toBe(3);
    expect(locate(three(), 7)?.sourceTime).toBe(2);
  });

  it("maps the very end to the end of the last clip", () => {
    const hit = locate(three(), 9);
    expect(hit?.clip.id).toBe("c");
    expect(hit?.sourceTime).toBe(6);
  });

  it("finds nothing on an empty timeline", () => {
    expect(locate([], 0)).toBeNull();
  });
});

describe("trim", () => {
  it("ripples later clips because positions are derived", () => {
    const trimmed = trimIn(three(), "a", 1);
    expect(clipEdges(trimmed)).toEqual([0, 3, 5, 8]);
  });

  it("stops at the source's bounds", () => {
    expect(trimIn(three(), "a", -5)[0].in).toBe(0);
    expect(trimOut(three(), "a", 99, 10)[0].out).toBe(10);
  });

  it("can't invert or empty a clip", () => {
    const inward = trimIn(three(), "a", 99)[0];
    expect(clipDuration(inward)).toBeCloseTo(0.05);
    const outward = trimOut(three(), "a", -99, 10)[0];
    expect(clipDuration(outward)).toBeCloseTo(0.05);
  });

  it("keeps the minimum length in timeline time for fast clips", () => {
    const fast = trimIn([clip("f", 0, 8, 4)], "f", 99)[0];
    expect(clipDuration(fast)).toBeCloseTo(0.05);
  });
});

describe("blade", () => {
  it("splits at the playhead without changing the total", () => {
    const cut = blade(three(), 5, "n");
    expect(ids(cut)).toBe("abnc");
    expect(cut[1].out).toBe(3);
    expect(cut[2].in).toBe(3);
    expect(totalDuration(cut)).toBe(9);
  });

  it("maps through speed", () => {
    const cut = blade(three(), 7, "n");
    expect(cut[2].out).toBe(2);
    expect(cut[3].in).toBe(2);
    expect(totalDuration(cut)).toBe(9);
  });

  it("ignores cuts on a clip's edge", () => {
    expect(blade(three(), 4, "n")).toHaveLength(3);
    expect(blade(three(), 0, "n")).toHaveLength(3);
    expect(blade(three(), 9, "n")).toHaveLength(3);
  });
});

describe("arranging", () => {
  it("removes and closes the gap", () => {
    const left = removeClip(three(), "b");
    expect(ids(left)).toBe("ac");
    expect(totalDuration(left)).toBe(7);
  });

  it("moves to the requested index", () => {
    expect(ids(moveClip(three(), "a", 2))).toBe("bca");
    expect(ids(moveClip(three(), "c", 0))).toBe("cab");
    expect(ids(moveClip(three(), "b", 1))).toBe("abc");
  });

  it("clamps out-of-range moves", () => {
    expect(ids(moveClip(three(), "a", 99))).toBe("bca");
    expect(ids(moveClip(three(), "c", -3))).toBe("cab");
  });

  it("duplicates after the original", () => {
    const copy = duplicateClip(three(), "a", "n");
    expect(ids(copy)).toBe("anbc");
    expect(copy[1].in).toBe(copy[0].in);
  });
});

describe("snap", () => {
  it("snaps within tolerance to the nearest target", () => {
    expect(snap(4.04, [1, 4, 4.1], 0.2)).toBe(4);
    expect(snap(4.5, [1, 4], 0.2)).toBe(4.5);
  });
});
