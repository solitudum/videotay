import { beforeEach, describe, expect, it } from "vitest";
import type { Source } from "../types";
import { totalDuration } from "./ops";
import { useProject } from "./project";

const source = (id: string, duration: number): Source => ({
  id,
  path: `/${id}.mp4`,
  name: `${id}.mp4`,
  duration,
  width: 1280,
  height: 720,
  fps: 30,
  codec: "h264",
  hasAudio: true,
  playUrl: "",
  proxying: false,
  thumbs: null,
  waveform: null,
});

const state = () => useProject.getState();

beforeEach(() => {
  useProject.setState({ clips: [], past: [], future: [], selectedId: null, playhead: 0 });
  state().addSource(source("a", 10));
  state().addSource(source("b", 5));
  state().appendClip(state().sources.a);
  state().appendClip(state().sources.b);
});

describe("undo", () => {
  it("undoes and redoes each edit", () => {
    state().seek(4);
    state().bladeAtPlayhead();
    expect(state().clips).toHaveLength(3);
    state().undo();
    expect(state().clips).toHaveLength(2);
    state().redo();
    expect(state().clips).toHaveLength(3);
  });

  it("treats a checkpointed drag as one step", () => {
    const id = state().clips[0].id;
    const before = state().clips;
    state().checkpoint();
    state().updateClip(id, { out: 9 });
    state().updateClip(id, { out: 8 });
    state().undo();
    expect(state().clips).toBe(before);
  });

  it("clears redo after a new edit", () => {
    state().seek(4);
    state().bladeAtPlayhead();
    state().undo();
    state().duplicateSelected();
    state().redo();
    expect(state().future).toHaveLength(0);
  });

  it("doesn't record edits that change nothing", () => {
    const steps = state().past.length;
    state().seek(10);
    state().bladeAtPlayhead();
    expect(state().past).toHaveLength(steps);
  });
});

describe("playhead and selection", () => {
  it("pulls the playhead back when the timeline shrinks", () => {
    state().seek(14);
    state().select(state().clips[1].id);
    state().deleteSelected();
    expect(state().playhead).toBe(10);
    expect(totalDuration(state().clips)).toBe(10);
  });

  it("selects the neighbor after deleting", () => {
    const [first, second] = state().clips;
    state().select(first.id);
    state().deleteSelected();
    expect(state().selectedId).toBe(second.id);
  });

  it("clears selection when the selected clip is undone away", () => {
    state().duplicateSelected();
    const added = state().selectedId;
    state().undo();
    expect(state().selectedId).not.toBe(added);
  });

  it("jumps between edits", () => {
    state().seek(3);
    state().jumpEdit(1);
    expect(state().playhead).toBe(10);
    state().jumpEdit(1);
    expect(state().playhead).toBe(15);
    state().jumpEdit(-1);
    expect(state().playhead).toBe(10);
  });

  it("steps by the source's frame length", () => {
    state().seek(1);
    state().stepFrames(3);
    expect(state().playhead).toBeCloseTo(1.1);
  });
});

describe("in and out at the playhead", () => {
  it("trims the clip under the playhead", () => {
    state().seek(4);
    state().trimOutAtPlayhead();
    expect(state().clips[0].out).toBe(4);
    state().seek(1);
    state().trimInAtPlayhead();
    expect(state().clips[0].in).toBe(1);
    expect(totalDuration(state().clips)).toBe(8);
  });
});

describe("crop mode", () => {
  it("moves the playhead onto the clip being cropped", () => {
    state().seek(2);
    state().select(state().clips[1].id);
    state().setCropMode(true);
    expect(state().playhead).toBe(10);
    expect(state().cropMode).toBe(true);
  });

  it("stops playback and is closed by playing", () => {
    state().setPlaying(true);
    state().setCropMode(true);
    expect(state().playing).toBe(false);
    state().setPlaying(true);
    expect(state().cropMode).toBe(false);
    state().setPlaying(false);
  });
});

describe("shuttle", () => {
  it("doubles on repeat and resets when reversing", () => {
    state().shuttleBy(1);
    expect(state().shuttle).toBe(1);
    state().shuttleBy(1);
    expect(state().shuttle).toBe(2);
    state().shuttleBy(1);
    state().shuttleBy(1);
    expect(state().shuttle).toBe(4);
    state().shuttleBy(-1);
    expect(state().shuttle).toBe(-1);
    state().setPlaying(false);
  });
});
