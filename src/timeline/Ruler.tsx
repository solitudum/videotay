import { useEffect, useRef, type PointerEvent } from "react";

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const MIN_LABEL_GAP = 72;

const label = (seconds: number, step: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  const text = step < 1 ? rest.toFixed(1).padStart(4, "0") : String(Math.round(rest)).padStart(2, "0");
  return `${minutes}:${text}`;
};

interface Props {
  width: number;
  scrollLeft: number;
  pad: number;
  pxPerSec: number;
  onPointerDown(event: PointerEvent): void;
}

export function Ruler({ width, scrollLeft, pad, pxPerSec, onPointerDown }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || width <= 0) return;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);

    const style = getComputedStyle(canvas);
    const step = STEPS.find((s) => s * pxPerSec >= MIN_LABEL_GAP) ?? 3600;
    const minor = step / 5;
    context.font = `10px ${style.fontFamily}`;
    context.textBaseline = "top";

    const first = Math.floor((scrollLeft - pad) / pxPerSec / minor);
    const last = Math.ceil((scrollLeft + width - pad) / pxPerSec / minor);
    for (let i = Math.max(0, first); i <= last; i++) {
      const time = i * minor;
      const x = Math.round(pad + time * pxPerSec - scrollLeft) + 0.5;
      const major = i % 5 === 0;
      context.fillStyle = major ? style.getPropertyValue("--text-3") : style.getPropertyValue("--line");
      context.fillRect(x, height - (major ? 7 : 4), 1, major ? 7 : 4);
      if (major) {
        context.fillStyle = style.getPropertyValue("--text-3");
        context.fillText(label(time, step), x + 4, 5);
      }
    }
  }, [width, scrollLeft, pad, pxPerSec]);

  return <canvas ref={ref} className="ruler" style={{ width }} onPointerDown={onPointerDown} />;
}
