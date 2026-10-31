import type { PointerEvent as ReactPointerEvent } from "react";
import { clipSize } from "../state/output";
import { useProject } from "../state/project";
import type { Clip, Crop, Source } from "../types";
import { moveCrop, normalizedRatio, resizeCrop, type Box, type CropHandle } from "./layout";

const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

export function CropOverlay({ clip, source, box }: { clip: Clip; source: Source; box: Box }) {
  const crop = clip.crop ?? FULL;

  const begin = (event: ReactPointerEvent, update: (dx: number, dy: number) => Crop) => {
    event.preventDefault();
    event.stopPropagation();
    const { checkpoint, updateClip } = useProject.getState();
    const { clientX, clientY } = event;
    let moved = false;
    const onMove = (move: PointerEvent) => {
      if (!moved) checkpoint();
      moved = true;
      const dx = (move.clientX - clientX) / box.width;
      const dy = (move.clientY - clientY) / box.height;
      updateClip(clip.id, { crop: update(dx, dy) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const aspect = useProject((state) => state.cropAspect);
  const ratio = aspect === null ? null : normalizedRatio(aspect, clip, source);
  const position = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`,
  };
  const size = clipSize(clip, source);

  return (
    <div className="crop-overlay" style={{ width: box.width, height: box.height }}>
      <div className="crop-shade">
        <div className="crop-hole" style={position} />
      </div>
      <div
        className="crop-rect"
        style={position}
        onPointerDown={(event) => begin(event, (dx, dy) => moveCrop(crop, dx, dy))}
      >
        <i className="crop-third v1" />
        <i className="crop-third v2" />
        <i className="crop-third h1" />
        <i className="crop-third h2" />
        <span className="crop-size">{Math.round(size.width)}×{Math.round(size.height)}</span>
        {HANDLES.map((handle) => (
          <span
            key={handle}
            className={`crop-handle ${handle}`}
            onPointerDown={(event) =>
              begin(event, (dx, dy) => resizeCrop(crop, handle, dx, dy, ratio))
            }
          />
        ))}
      </div>
    </div>
  );
}
