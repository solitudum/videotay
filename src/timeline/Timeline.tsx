import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react";
import { duration, shortcutLabel, timecode } from "../format";
import { clipDuration, clipEdges, locate, moveClip, snap, totalDuration, trimIn, trimOut } from "../state/ops";
import { useProject } from "../state/project";
import type { Clip } from "../types";
import { ClipView } from "./ClipView";
import { Ruler } from "./Ruler";

const PAD = 14;
const TAIL = 160;
const SNAP_PX = 8;
const DRAG_THRESHOLD = 4;
const EDGE_SCROLL_PX = 48;
/** Room above and below the clips: the ruler, then the track's margins. */
const TRACK_CHROME = 24 + 12 + 14;

/** Scrolls while a drag is near either edge, until the returned function is called. */
function startEdgeScroll(element: HTMLElement, pointerX: () => number, onScroll: () => void) {
  let frame = 0;
  const tick = () => {
    const rect = element.getBoundingClientRect();
    const before = element.scrollLeft;
    if (pointerX() < rect.left + EDGE_SCROLL_PX) element.scrollLeft -= 10;
    else if (pointerX() > rect.right - EDGE_SCROLL_PX) element.scrollLeft += 10;
    if (element.scrollLeft !== before) onScroll();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

function Timecode() {
  const playhead = useProject((state) => state.playhead);
  const clips = useProject((state) => state.clips);
  const sources = useProject((state) => state.sources);
  const clip = locate(clips, playhead)?.clip;
  const fps = (clip && sources[clip.sourceId]?.fps) || 30;
  return (
    <div className="timecode">
      <span>{timecode(playhead, fps)}</span>
      <i>/</i>
      <span className="dim">{timecode(totalDuration(clips), fps)}</span>
    </div>
  );
}

function IconButton({ title, keys, onClick, disabled, children }: {
  title: string;
  keys?: string;
  onClick(): void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className="icon-button"
      title={keys ? `${title}  ${shortcutLabel(keys)}` : title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

interface ReorderDrag {
  id: string;
  left: number;
  insert: number;
}

interface TrimHint {
  x: number;
  text: string;
}

export function Timeline() {
  const clips = useProject((state) => state.clips);
  const sources = useProject((state) => state.sources);
  const selectedId = useProject((state) => state.selectedId);
  const pxPerSec = useProject((state) => state.pxPerSec);
  const fitMode = useProject((state) => state.fit);
  const playing = useProject((state) => state.playing);
  const canUndo = useProject((state) => state.past.length > 0);
  const canRedo = useProject((state) => state.future.length > 0);

  const scroller = useRef<HTMLDivElement>(null);
  const playheadEl = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ time: number; x: number } | null>(null);
  const renderedPx = useRef(pxPerSec);
  /** Set while a drag is moving the playhead, which then doesn't scroll to follow. */
  const holdingPlayhead = useRef(false);
  const [view, setView] = useState({ left: 0, width: 0, height: 0 });
  const [trimming, setTrimming] = useState(false);
  const [reorder, setReorder] = useState<ReorderDrag | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [hint, setHint] = useState<TrimHint | null>(null);

  const total = totalDuration(clips);

  // Fit mode keeps the whole timeline in view as it or the window changes. Trims
  // wait until they end, or the clip's edge would slide out from under the pointer.
  useEffect(() => {
    if (!fitMode || trimming || view.width === 0 || total === 0) return;
    const next = Math.max(1, (view.width - PAD * 2 - 24) / total);
    if (Math.abs(next - useProject.getState().pxPerSec) > 0.01) {
      useProject.setState({ pxPerSec: next });
    }
  }, [fitMode, trimming, view.width, total]);

  useEffect(() => {
    const element = scroller.current!;
    const update = () =>
      setView({ left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, []);

  // Pinch and modifier-scroll zoom around the pointer.
  useEffect(() => {
    const element = scroller.current!;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const state = useProject.getState();
      const x = event.clientX - element.getBoundingClientRect().left;
      zoomAnchor.current = { time: (element.scrollLeft + x - PAD) / state.pxPerSec, x };
      state.setZoom(state.pxPerSec * Math.exp(-event.deltaY * 0.01));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    const anchor = zoomAnchor.current;
    const previousPx = renderedPx.current;
    zoomAnchor.current = null;
    renderedPx.current = pxPerSec;
    if (!element) return;
    if (anchor) {
      element.scrollLeft = anchor.time * pxPerSec + PAD - anchor.x;
    } else if (!fitMode && previousPx !== pxPerSec) {
      // Buttons and shortcuts zoom around the playhead, bringing it into view if needed.
      const { playhead } = useProject.getState();
      const before = PAD + playhead * previousPx - view.left;
      const x = before >= 0 && before <= view.width ? before : view.width / 2;
      element.scrollLeft = PAD + playhead * pxPerSec - x;
    }
  }, [pxPerSec]); // eslint-disable-line

  // The playhead moves every frame, so it skips React and goes straight to the DOM.
  useEffect(() => {
    const place = (time: number, px: number) => {
      const x = PAD + time * px;
      if (playheadEl.current) playheadEl.current.style.transform = `translateX(${x}px)`;
    };
    /** Turns the page when the playhead leaves the view, leaving room to keep going. */
    const follow = (time: number, px: number, margin: number) => {
      const element = scroller.current;
      if (!element) return;
      const x = PAD + time * px;
      if (x > element.scrollLeft + element.clientWidth - margin) element.scrollLeft = x - 80;
      else if (x < element.scrollLeft) element.scrollLeft = x - element.clientWidth + 80;
    };
    const { playhead, pxPerSec: px } = useProject.getState();
    place(playhead, px);
    return useProject.subscribe((state, previous) => {
      if (state.playhead !== previous.playhead || state.pxPerSec !== previous.pxPerSec) {
        place(state.playhead, state.pxPerSec);
      }
      if (state.playhead !== previous.playhead && !holdingPlayhead.current) {
        follow(state.playhead, state.pxPerSec, state.playing ? 40 : 0);
      }
    });
  }, []);

  const timeAt = useCallback((clientX: number) => {
    const element = scroller.current!;
    const x = clientX - element.getBoundingClientRect().left + element.scrollLeft - PAD;
    return x / useProject.getState().pxPerSec;
  }, []);

  const trackDrag = (onMove: (event: PointerEvent) => void, onEnd: () => void) => {
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onEnd();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const beginScrub = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    let pointerX = event.clientX;
    let stopScroll: (() => void) | null = null;
    const seekToPointer = () => {
      const state = useProject.getState();
      const time = snap(timeAt(pointerX), clipEdges(state.clips), SNAP_PX / state.pxPerSec);
      state.seek(time);
    };
    holdingPlayhead.current = true;
    seekToPointer();
    trackDrag(
      (move) => {
        pointerX = move.clientX;
        stopScroll ??= startEdgeScroll(scroller.current!, () => pointerX, seekToPointer);
        seekToPointer();
      },
      () => {
        stopScroll?.();
        holdingPlayhead.current = false;
      },
    );
  };

  const beginTrim = useCallback(
    (event: ReactPointerEvent, clip: Clip, side: "in" | "out") => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const state = useProject.getState();
      state.select(clip.id);
      const startClips = state.clips;
      const edges = clipEdges(startClips);
      const index = startClips.findIndex((c) => c.id === clip.id);
      const edge = side === "in" ? edges[index] : edges[index + 1];
      const targets = [state.playhead, ...edges.filter((_, i) => i !== index && i !== index + 1)];
      const sourceDuration = state.sources[clip.sourceId]?.duration ?? clip.out;
      const startX = event.clientX;
      const startScroll = scroller.current!.scrollLeft;
      let pointerX = startX;
      let moved = false;
      let stopScroll: (() => void) | null = null;

      const applyTrim = () => {
        const current = useProject.getState();
        const dx = pointerX - startX + scroller.current!.scrollLeft - startScroll;
        if (!moved && Math.abs(dx) < 2) return;
        if (!moved) {
          current.checkpoint();
          setTrimming(true);
          holdingPlayhead.current = true;
          stopScroll = startEdgeScroll(scroller.current!, () => pointerX, applyTrim);
        }
        moved = true;
        const px = current.pxPerSec;
        const wanted = edge + dx / px;
        const snapped = snap(wanted, targets, SNAP_PX / px);
        setGuide(snapped !== wanted ? PAD + snapped * px : null);
        const delta = (snapped - edge) * clip.speed;
        const next =
          side === "in"
            ? trimIn(startClips, clip.id, clip.in + delta)
            : trimOut(startClips, clip.id, clip.out + delta, sourceDuration);
        current.setClips(next);
        const trimmed = next[index];
        const change = clipDuration(trimmed) - clipDuration(clip);
        const sign = change >= 0 ? "+" : "−";
        setHint({
          x: PAD + edges[index] * px + (side === "in" ? 0 : clipDuration(trimmed) * px),
          text: `${duration(clipDuration(trimmed))}  ${sign}${Math.abs(change).toFixed(2)}s`,
        });
      };

      trackDrag(
        (move) => {
          pointerX = move.clientX;
          applyTrim();
        },
        () => {
          stopScroll?.();
          holdingPlayhead.current = false;
          setTrimming(false);
          setGuide(null);
          setHint(null);
        },
      );
    },
    [],
  );

  const beginBody = useCallback(
    (event: ReactPointerEvent, clip: Clip) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const state = useProject.getState();
      state.select(clip.id);

      const element = scroller.current!;
      const index = state.clips.findIndex((c) => c.id === clip.id);
      const px = state.pxPerSec;
      const startLeft = PAD + clipEdges(state.clips)[index] * px;
      const startX = event.clientX;
      const startScroll = element.scrollLeft;
      const others = state.clips.filter((c) => c.id !== clip.id);
      const width = clipDuration(clip) * px;
      let dragging = false;
      let pointerX = event.clientX;
      let stopScroll: (() => void) | null = null;
      let latest: ReorderDrag | null = null;

      const updateDrag = () => {
        const left = startLeft + pointerX - startX + element.scrollLeft - startScroll;
        const center = left + width / 2;
        // Insert before the first remaining clip whose middle is past this one's.
        let insert = others.length;
        let cursor = PAD;
        for (let i = 0; i < others.length; i++) {
          const size = clipDuration(others[i]) * px;
          if (center < cursor + size / 2) {
            insert = i;
            break;
          }
          cursor += size;
        }
        latest = { id: clip.id, left, insert };
        setReorder(latest);
      };

      trackDrag(
        (move) => {
          pointerX = move.clientX;
          if (!dragging && Math.abs(pointerX - startX) < DRAG_THRESHOLD) return;
          if (!dragging && state.clips.length > 1) {
            dragging = true;
            stopScroll = startEdgeScroll(element, () => pointerX, updateDrag);
          }
          if (dragging) updateDrag();
        },
        () => {
          stopScroll?.();
          if (dragging && latest) {
            const { insert } = latest;
            useProject.getState().edit((current) => moveClip(current, clip.id, insert));
          } else if (!dragging) {
            useProject.getState().seek(timeAt(startX));
          }
          setReorder(null);
        },
      );
    },
    [timeAt],
  );

  const layout = useMemo(() => {
    const placed = new Map<string, { left: number; width: number }>();
    if (!reorder) {
      let x = PAD;
      for (const clip of clips) {
        const width = clipDuration(clip) * pxPerSec;
        placed.set(clip.id, { left: x, width });
        x += width;
      }
      return placed;
    }
    const dragged = clips.find((c) => c.id === reorder.id);
    const gap = dragged ? clipDuration(dragged) * pxPerSec : 0;
    let x = PAD;
    clips
      .filter((c) => c.id !== reorder.id)
      .forEach((clip, i) => {
        if (i === reorder.insert) x += gap;
        const width = clipDuration(clip) * pxPerSec;
        placed.set(clip.id, { left: x, width });
        x += width;
      });
    placed.set(reorder.id, { left: reorder.left, width: gap });
    return placed;
  }, [clips, pxPerSec, reorder]);

  const contentWidth = Math.max(view.width, PAD * 2 + total * pxPerSec + (fitMode ? 0 : TAIL));
  const viewStart = view.left - 64;
  const viewEnd = view.left + view.width + 64;
  // The filmstrip takes two thirds of a clip; its tiles keep the video's shape.
  const stripHeight = Math.round((Math.max(0, view.height - TRACK_CHROME) * 2) / 3);
  const actions = useProject.getState();
  const empty = clips.length === 0;

  return (
    <section className="timeline">
      <div className="transport">
        <div className="transport-group">
          <IconButton title="Previous edit" onClick={() => actions.jumpEdit(-1)} disabled={empty}>
            <SkipBack size={14} />
          </IconButton>
          <IconButton title={playing ? "Pause" : "Play"} keys="Space" onClick={actions.togglePlay} disabled={empty}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <IconButton title="Next edit" onClick={() => actions.jumpEdit(1)} disabled={empty}>
            <SkipForward size={14} />
          </IconButton>
          <Timecode />
        </div>
        <div className="transport-group">
          <IconButton title="Undo" keys="mod+Z" onClick={actions.undo} disabled={!canUndo}>
            <Undo2 size={14} />
          </IconButton>
          <IconButton title="Redo" keys="mod+shift+Z" onClick={actions.redo} disabled={!canRedo}>
            <Redo2 size={14} />
          </IconButton>
          <span className="divider" />
          <IconButton title="Blade at playhead" keys="mod+B" onClick={actions.bladeAtPlayhead} disabled={empty}>
            <Scissors size={14} />
          </IconButton>
          <IconButton title="Delete clip" keys="Backspace" onClick={actions.deleteSelected} disabled={!selectedId}>
            <Trash2 size={14} />
          </IconButton>
          <span className="divider" />
          <IconButton title="Zoom out" keys="mod+-" onClick={() => actions.setZoom(pxPerSec / 1.4)} disabled={empty}>
            <Minus size={14} />
          </IconButton>
          <IconButton title="Zoom in" keys="mod+=" onClick={() => actions.setZoom(pxPerSec * 1.4)} disabled={empty}>
            <Plus size={14} />
          </IconButton>
          <IconButton title="Zoom to fit" keys="shift+Z" onClick={actions.zoomToFit} disabled={empty}>
            <Maximize2 size={13} />
          </IconButton>
        </div>
      </div>

      <div className="scroller" ref={scroller}>
        <div className="scroll-content" style={{ width: contentWidth }}>
          <Ruler
            width={view.width}
            scrollLeft={view.left}
            pad={PAD}
            pxPerSec={pxPerSec}
            onPointerDown={beginScrub}
          />
          <div className="track" onPointerDown={beginScrub}>
            {clips.map((clip) => {
              const place = layout.get(clip.id);
              if (!place) return null;
              const floating = reorder?.id === clip.id;
              return (
                <ClipView
                  key={clip.id}
                  clip={clip}
                  source={sources[clip.sourceId]}
                  left={place.left}
                  width={place.width}
                  selected={clip.id === selectedId}
                  floating={floating}
                  animated={!!reorder && !floating}
                  pxPerSec={pxPerSec}
                  stripHeight={stripHeight}
                  viewStart={viewStart}
                  viewEnd={viewEnd}
                  onBodyDown={beginBody}
                  onEdgeDown={beginTrim}
                />
              );
            })}
            {empty && <div className="track-empty">Clips snap together here</div>}
          </div>
          {guide !== null && <div className="snap-guide" style={{ transform: `translateX(${guide}px)` }} />}
          {hint && (
            <div className="trim-hint" style={{ transform: `translateX(${hint.x}px)` }}>
              {hint.text}
            </div>
          )}
          <div className="playhead" ref={playheadEl} style={{ visibility: empty ? "hidden" : "visible" }} />
        </div>
      </div>
    </section>
  );
}
