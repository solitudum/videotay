import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Film, Loader } from "lucide-react";
import { pickAndImport } from "../media";
import { canvasSize } from "../state/output";
import { useProject } from "../state/project";
import type { Clip, Source } from "../types";
import { CropOverlay } from "./CropOverlay";
import { PreviewEngine, usePreviewSlots } from "./engine";
import { clipLayout, fit, type Box } from "./layout";

function slotStyles(clip: Clip | undefined, source: Source | undefined, canvas: Box, full: boolean) {
  if (!clip || !source) return null;
  const shown = full
    ? { ...clip, crop: null, rotate: 0 as const, flipH: false, flipV: false }
    : clip;
  const layout = clipLayout(shown, source, canvas);
  const frame: CSSProperties = {
    width: layout.frame.width,
    height: layout.frame.height,
    transform: layout.transform,
  };
  const video: CSSProperties = {
    width: layout.video.width,
    height: layout.video.height,
    left: layout.video.left,
    top: layout.video.top,
  };
  return { frame, video };
}

export function Preview({ dragging }: { dragging: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const [stage, setStage] = useState<Box>({ width: 0, height: 0 });

  const clips = useProject((state) => state.clips);
  const sources = useProject((state) => state.sources);
  const selectedId = useProject((state) => state.selectedId);
  const cropMode = useProject((state) => state.cropMode);
  const importing = useProject((state) => state.importing);
  const { slots, active } = usePreviewSlots();

  useEffect(() => {
    const engine = new PreviewEngine([videoA.current!, videoB.current!]);
    return () => engine.destroy();
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stageRef.current!);
    return () => observer.disconnect();
  }, []);

  const size = canvasSize(clips, sources, { format: "mp4", resolution: "source", gifWidth: 0 });
  const editing = cropMode ? clips.find((clip) => clip.id === selectedId) : undefined;
  const editingSource = editing && sources[editing.sourceId];
  const aspect = editingSource
    ? editingSource.width / editingSource.height
    : size.width / (size.height || 1);
  const canvas = fit(stage, aspect);

  const proxying = clips.some((clip) => sources[clip.sourceId]?.proxying);
  const empty = clips.length === 0;

  return (
    <div className={`stage ${dragging ? "dropping" : ""}`} ref={stageRef}>
      <div
        className={`canvas ${editing ? "" : "playable"}`}
        style={{ ...canvas, visibility: empty ? "hidden" : "visible" }}
        onClick={editing ? undefined : () => useProject.getState().togglePlay()}
      >
        {[videoA, videoB].map((ref, slot) => {
          const clip = clips.find((c) => c.id === slots[slot]);
          const source = clip && sources[clip.sourceId];
          const styles = slotStyles(clip, source, canvas, editing?.id === clip?.id && !!editing);
          return (
            <div
              key={slot}
              className="slot"
              style={{ opacity: slot === active && styles ? 1 : 0 }}
            >
              <div className="slot-frame" style={styles?.frame}>
                <video ref={ref} style={styles?.video} playsInline preload="auto" />
              </div>
            </div>
          );
        })}
        {editing && editingSource && (
          <CropOverlay clip={editing} source={editingSource} box={canvas} />
        )}
      </div>

      {empty && (
        <button className="dropzone" onClick={() => void pickAndImport()}>
          {importing > 0 ? <Loader size={20} className="spin" /> : <Film size={20} strokeWidth={1.5} />}
          <strong>{importing > 0 ? "Importing" : "Drop videos here"}</strong>
          <span>or click to browse</span>
        </button>
      )}
      {!empty && (importing > 0 || proxying) && (
        <div className="stage-badge">
          <Loader size={12} className="spin" /> {importing > 0 ? "Importing" : "Preparing preview"}
        </div>
      )}
    </div>
  );
}
