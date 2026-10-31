import { memo, useEffect, useRef, type PointerEvent } from "react";
import { VolumeX } from "lucide-react";
import type { Clip, Source } from "../types";

const WAVEFORM_RATE = 20;

interface Props {
  clip: Clip;
  source: Source | undefined;
  left: number;
  width: number;
  selected: boolean;
  floating: boolean;
  animated: boolean;
  pxPerSec: number;
  stripHeight: number;
  /** The part of the track on screen, in track pixels. */
  viewStart: number;
  viewEnd: number;
  onBodyDown(event: PointerEvent, clip: Clip): void;
  onEdgeDown(event: PointerEvent, clip: Clip, side: "in" | "out"): void;
}

function Filmstrip({ clip, source, pxPerSec, height, from, to }: {
  clip: Clip;
  source: Source;
  pxPerSec: number;
  height: number;
  from: number;
  to: number;
}) {
  const thumbs = source.thumbs;
  if (!thumbs || thumbs.urls.length === 0) return <div className="filmstrip empty" />;
  const tile = Math.max(24, (height * source.width) / source.height);
  const images = [];
  // Only tiles on screen are mounted, which keeps long clips at high zoom cheap.
  for (let i = Math.floor(from / tile); i * tile < to; i++) {
    const time = clip.in + ((i * tile + tile / 2) / pxPerSec) * clip.speed;
    const at = Math.min(thumbs.urls.length - 1, Math.max(0, Math.floor(time / thumbs.interval)));
    images.push(
      <img
        key={i}
        src={thumbs.urls[at]}
        alt=""
        draggable={false}
        style={{ left: i * tile, width: tile }}
      />,
    );
  }
  return <div className="filmstrip">{images}</div>;
}

function Waveform({ clip, peaks, pxPerSec, laneHeight, from, to }: {
  clip: Clip;
  peaks: number[];
  pxPerSec: number;
  laneHeight: number;
  from: number;
  to: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.ceil(to - from));

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    context.fillStyle = getComputedStyle(canvas).color;
    const gain = Math.min(1, clip.volume);
    for (let x = 0; x < width; x += 2) {
      const time = clip.in + ((from + x) / pxPerSec) * clip.speed;
      const peak = (peaks[Math.floor(time * WAVEFORM_RATE)] ?? 0) * gain;
      const bar = Math.max(1, peak * height);
      context.fillRect(x, height - bar, 1, bar);
    }
  }, [clip.in, clip.speed, clip.volume, peaks, pxPerSec, laneHeight, from, width]);

  return <canvas ref={ref} className="waveform" style={{ left: from, width }} />;
}

export const ClipView = memo(function ClipView({
  clip,
  source,
  left,
  width,
  selected,
  floating,
  animated,
  pxPerSec,
  stripHeight,
  viewStart,
  viewEnd,
  onBodyDown,
  onEdgeDown,
}: Props) {
  const from = Math.max(0, viewStart - left);
  const to = Math.min(width, viewEnd - left);
  const onScreen = to > from;
  const classes = [
    "clip",
    selected && "selected",
    floating && "floating",
    animated && "animated",
    clip.muted && "muted",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={{ transform: `translateX(${left}px)`, width }}
      onPointerDown={(event) => onBodyDown(event, clip)}
    >
      <div className="clip-inner">
        {source && onScreen && (
          <Filmstrip clip={clip} source={source} pxPerSec={pxPerSec} height={stripHeight} from={from} to={to} />
        )}
        <div className="wave-lane">
          {source?.waveform && source.waveform.length > 0 && !clip.muted && onScreen && (
            <Waveform
              clip={clip}
              peaks={source.waveform}
              pxPerSec={pxPerSec}
              laneHeight={stripHeight / 2}
              from={from}
              to={to}
            />
          )}
        </div>
        {width > 56 && (
          <div className="clip-label">
            {clip.muted && <VolumeX size={10} />}
            <span>{source?.name ?? "Missing"}</span>
            {clip.speed !== 1 && <em>{clip.speed}×</em>}
          </div>
        )}
      </div>
      <span
        className="clip-edge in"
        onPointerDown={(event) => onEdgeDown(event, clip, "in")}
      />
      <span
        className="clip-edge out"
        onPointerDown={(event) => onEdgeDown(event, clip, "out")}
      />
    </div>
  );
});
