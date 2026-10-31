import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { Command, Plus, RefreshCw, X } from "lucide-react";
import { backend } from "./backend";
import { handleKeyDown } from "./commands";
import { wireExportEvents } from "./exporting";
import { duration, platformIsMac, shortcutLabel } from "./format";
import { Inspector } from "./inspector/Inspector";
import { importFiles, pickAndImport } from "./media";
import { Palette } from "./palette/Palette";
import { Preview } from "./preview/Preview";
import { totalDuration } from "./state/ops";
import { useProject } from "./state/project";
import { Timeline } from "./timeline/Timeline";
import { checkForUpdate, installUpdate, useUpdate } from "./updates";

const TIMELINE_DEFAULT = 236;
const TIMELINE_MIN = 176;
const TIMELINE_MAX = 340;
/** Matches the room `--timeline-size` leaves for the header and preview. */
const TIMELINE_RESERVED = 260;
const TIMELINE_KEY = "videotay.timelineHeight";

function savedTimelineHeight() {
  try {
    const saved = Number(localStorage.getItem(TIMELINE_KEY));
    return saved >= TIMELINE_MIN && saved <= TIMELINE_MAX ? saved : TIMELINE_DEFAULT;
  } catch {
    return TIMELINE_DEFAULT;
  }
}

function saveTimelineHeight(height: number) {
  try {
    localStorage.setItem(TIMELINE_KEY, String(height));
  } catch {
    // Not worth interrupting anyone over: the next launch uses the default.
  }
}

function TimelineResizer({ onResize }: { onResize(height: number): void }) {
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const room = Math.min(TIMELINE_MAX, window.innerHeight - TIMELINE_RESERVED);
    const height = window.innerHeight - event.clientY;
    onResize(Math.round(Math.max(TIMELINE_MIN, Math.min(height, room))));
  };
  return (
    <div
      className="timeline-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      title="Drag to resize. Double-click to reset."
      onPointerDown={begin}
      onPointerMove={move}
      onDoubleClick={() => onResize(TIMELINE_DEFAULT)}
    />
  );
}

function UpdateButton() {
  const ready = useUpdate((state) => state.ready);
  const installing = useUpdate((state) => state.installing);
  const exporting = useProject((state) => state.run.status === "running");
  if (!ready) return null;
  return (
    <button
      className="button"
      disabled={installing || exporting}
      title={exporting ? "Available when the export finishes" : `Restart to install version ${ready.version}`}
      onClick={() => void installUpdate()}
    >
      <RefreshCw size={13} /> {installing ? "Restarting" : "Restart to update"}
    </button>
  );
}

function Header() {
  const count = useProject((state) => state.clips.length);
  const total = useProject((state) => totalDuration(state.clips));
  return (
    <header className={`app-header ${platformIsMac ? "mac" : ""}`} data-tauri-drag-region>
      <div className="app-title" data-tauri-drag-region>
        <strong data-tauri-drag-region>Videotay</strong>
        {count > 0 && (
          <span data-tauri-drag-region>
            {count} {count === 1 ? "clip" : "clips"} · {duration(total)}
          </span>
        )}
      </div>
      <div className="header-actions">
        <UpdateButton />
        <button
          className="button ghost"
          title={`Commands  ${shortcutLabel("mod+K")}`}
          onClick={() => useProject.getState().setPaletteOpen(true)}
        >
          {platformIsMac ? <Command size={12} /> : <span>Ctrl</span>}
          <span>K</span>
        </button>
        <button
          className="button"
          title={`Import videos  ${shortcutLabel("mod+O")}`}
          onClick={() => void pickAndImport()}
        >
          <Plus size={13} /> Import
        </button>
      </div>
    </header>
  );
}

function Notice() {
  const notice = useProject((state) => state.notice);
  const { notify } = useProject.getState();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => notify(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, notify]);
  if (!notice) return null;
  return (
    <div className="notice" role="status">
      <span>{notice}</span>
      <button className="icon-button small" aria-label="Dismiss" onClick={() => notify(null)}>
        <X size={12} />
      </button>
    </div>
  );
}

export function App() {
  const [dragging, setDragging] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(savedTimelineHeight);

  useEffect(() => {
    wireExportEvents();
    backend.onFileDrop({ hover: setDragging, drop: (paths) => void importFiles(paths) });
    void backend.encoders().then((encoders) => useProject.getState().setEncoders(encoders));
    void checkForUpdate();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const resizeTimeline = (height: number) => {
    setTimelineHeight(height);
    saveTimelineHeight(height);
  };

  return (
    <div className="app" style={{ "--timeline-height": `${timelineHeight}px` } as CSSProperties}>
      <Header />
      <main className="workspace">
        <Preview dragging={dragging} />
        <Inspector />
      </main>
      <Timeline />
      <TimelineResizer onResize={resizeTimeline} />
      <Notice />
      <Palette />
    </div>
  );
}
