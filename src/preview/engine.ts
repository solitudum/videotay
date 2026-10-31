import { create } from "zustand";
import { clipDuration, clipEdges, locate, totalDuration } from "../state/ops";
import { useProject, type ProjectState } from "../state/project";
import type { Clip } from "../types";

/** Which clip each of the two video elements holds, and which one is showing. */
export const usePreviewSlots = create<{ slots: (string | null)[]; active: number }>(() => ({
  slots: [null, null],
  active: 0,
}));

const END_EPSILON = 0.02;

function once(target: HTMLVideoElement, event: string, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, finish);
      target.removeEventListener("error", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, timeout);
    target.addEventListener(event, finish);
    target.addEventListener("error", finish);
  });
}

/**
 * Plays the timeline through two video elements, so the next clip is already
 * decoded and seeked when the current one ends. It owns the playhead while
 * playing; while paused it follows the playhead.
 */
export class PreviewEngine {
  private active = 0;
  private slots: (string | null)[] = [null, null];
  private ready = [false, false];
  private frame = 0;
  private lastTick = 0;
  private playToken = 0;
  private advancing = false;
  private queued: { clip: Clip; time: number } | null = null;
  private showing = false;
  private unsubscribe: () => void;

  constructor(private videos: HTMLVideoElement[]) {
    this.unsubscribe = useProject.subscribe((state, previous) => this.onChange(state, previous));
    this.showCurrent();
  }

  destroy() {
    this.unsubscribe();
    this.stopPlayback();
  }

  private get state() {
    return useProject.getState();
  }

  private onChange(state: ProjectState, previous: ProjectState) {
    const edited = state.clips !== previous.clips || state.sources !== previous.sources;
    if (state.playing !== previous.playing) {
      if (state.playing) void this.startPlayback();
      else this.stopPlayback();
    } else if (state.playing && edited) {
      void this.startPlayback();
    } else if (state.playing && state.shuttle !== previous.shuttle) {
      void this.startPlayback();
    }
    if (!state.playing && (state.playhead !== previous.playhead || edited)) {
      this.showCurrent();
    }
  }

  private publish() {
    usePreviewSlots.setState({ slots: [...this.slots], active: this.active });
  }

  private async load(slot: number, clip: Clip, time: number) {
    const video = this.videos[slot];
    const url = this.state.sources[clip.sourceId]?.playUrl;
    if (!url) return;
    this.ready[slot] = false;
    this.slots[slot] = clip.id;
    this.publish();
    if (video.dataset.url !== url) {
      video.dataset.url = url;
      video.src = url;
      video.load();
      await once(video, "loadedmetadata", 8000);
    }
    if (Math.abs(video.currentTime - time) > 0.001) {
      video.currentTime = time;
      await once(video, "seeked", 3000);
    }
    if (video.readyState < 2) await once(video, "canplay", 3000);
    if (this.slots[slot] === clip.id) this.ready[slot] = true;
  }

  /** Shows the frame under the playhead, dropping seeks it can't keep up with. */
  private showCurrent() {
    const hit = locate(this.state.clips, this.state.playhead);
    if (!hit) {
      this.slots = [null, null];
      this.publish();
      return;
    }
    this.queued = { clip: hit.clip, time: hit.sourceTime };
    if (this.showing) return;
    this.showing = true;
    void (async () => {
      while (this.queued) {
        const { clip, time } = this.queued;
        this.queued = null;
        await this.load(this.active, clip, time);
        this.applyAudio(clip);
      }
      this.showing = false;
      this.preloadNext();
    })();
  }

  /** Readies the clip after the current one in the hidden element. */
  private preloadNext() {
    const { clips, playhead } = this.state;
    const hit = locate(clips, playhead);
    const next = hit && clips[hit.index + 1];
    if (next) void this.load(1 - this.active, next, next.in);
  }

  private applyAudio(clip: Clip) {
    const video = this.videos[this.active];
    this.videos[1 - this.active].muted = true;
    video.muted = clip.muted;
    video.volume = Math.min(1, clip.volume);
  }

  private async startPlayback() {
    const token = ++this.playToken;
    this.advancing = true;
    cancelAnimationFrame(this.frame);
    this.videos.forEach((video) => video.pause());

    const { clips, playhead, shuttle } = this.state;
    const atEnd = playhead >= totalDuration(clips) - END_EPSILON;
    if (shuttle > 0 && atEnd) useProject.setState({ playhead: 0 });

    if (shuttle > 0) {
      const hit = locate(clips, this.state.playhead);
      if (!hit) return;
      await this.load(this.active, hit.clip, hit.sourceTime);
      if (token !== this.playToken) return;
      await this.playClip(hit.clip, token);
    }
    this.advancing = false;
    this.lastTick = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private async playClip(clip: Clip, token: number) {
    const video = this.videos[this.active];
    this.applyAudio(clip);
    video.playbackRate = Math.min(16, clip.speed * Math.abs(this.state.shuttle));
    try {
      await video.play();
    } catch {
      if (token === this.playToken) useProject.setState({ playing: false });
      return;
    }
    const { clips } = this.state;
    const next = clips[clips.findIndex((c) => c.id === clip.id) + 1];
    if (next && token === this.playToken) void this.load(1 - this.active, next, next.in);
  }

  private stopPlayback() {
    this.playToken++;
    cancelAnimationFrame(this.frame);
    this.videos.forEach((video) => video.pause());
    this.advancing = false;
  }

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    if (this.advancing) return;
    const { clips, playhead, shuttle } = this.state;

    if (shuttle < 0) {
      const time = playhead + ((now - this.lastTick) / 1000) * shuttle;
      this.lastTick = now;
      useProject.setState({ playhead: Math.max(0, time) });
      if (time <= 0) useProject.setState({ playing: false, shuttle: 1 });
      this.showCurrent();
      return;
    }

    const index = clips.findIndex((clip) => clip.id === this.slots[this.active]);
    if (index < 0) return;
    const clip = clips[index];
    const video = this.videos[this.active];
    if (video.ended || video.currentTime >= clip.out - END_EPSILON) {
      void this.advance(index);
      return;
    }
    const start = clipEdges(clips)[index];
    const offset = Math.max(0, video.currentTime - clip.in) / clip.speed;
    useProject.setState({ playhead: start + Math.min(offset, clipDuration(clip)) });
  };

  private async advance(index: number) {
    const token = this.playToken;
    const { clips } = this.state;
    const next = clips[index + 1];
    this.videos[this.active].pause();
    if (!next) {
      useProject.setState({ playhead: totalDuration(clips), playing: false, shuttle: 1 });
      return;
    }
    this.advancing = true;
    useProject.setState({ playhead: clipEdges(clips)[index + 1] });
    const standby = 1 - this.active;
    if (this.slots[standby] === next.id && this.ready[standby]) {
      this.active = standby;
      this.publish();
    } else {
      await this.load(this.active, next, next.in);
      if (token !== this.playToken) return;
    }
    await this.playClip(next, token);
    if (token === this.playToken) this.advancing = false;
  }
}
