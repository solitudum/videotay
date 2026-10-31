import {
  Crop as CropIcon,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { duration } from "../format";
import { centeredCrop, normalizedRatio } from "../preview/layout";
import { clipDuration } from "../state/ops";
import { useProject } from "../state/project";
import type { Clip, Rotation, Source } from "../types";
import { Section, Segmented, Slider } from "./controls";

const ASPECTS: { value: string; label: string; aspect: number | null }[] = [
  { value: "free", label: "Free", aspect: null },
  { value: "16:9", label: "16:9", aspect: 16 / 9 },
  { value: "9:16", label: "9:16", aspect: 9 / 16 },
  { value: "1:1", label: "1:1", aspect: 1 },
  { value: "4:5", label: "4:5", aspect: 4 / 5 },
];
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

export function ClipPanel({ clip, source }: { clip: Clip; source: Source }) {
  const cropMode = useProject((state) => state.cropMode);
  const cropAspect = useProject((state) => state.cropAspect);
  const { edit, checkpoint, updateClip, setCropMode } = useProject.getState();

  /** Applies a change as a single undo step. */
  const change = (patch: Partial<Clip>) =>
    edit((clips) => clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)));

  const pickAspect = (value: string) => {
    const aspect = ASPECTS.find((a) => a.value === value)?.aspect ?? null;
    useProject.setState({ cropAspect: aspect });
    setCropMode(true);
    if (aspect !== null) change({ crop: centeredCrop(normalizedRatio(aspect, clip, source)) });
  };
  const aspectValue = ASPECTS.find((a) => a.aspect === cropAspect)?.value ?? "free";

  const rotate = (by: number) =>
    change({ rotate: ((clip.rotate + by + 360) % 360) as Rotation });

  return (
    <>
      <Section title="Source">
        <p className="clip-name" title={source.path}>{source.name}</p>
        <p className="meta">
          {source.width}×{source.height} · {Math.round(source.fps * 100) / 100} fps · {source.codec}
        </p>
        <p className="meta">
          {duration(clipDuration(clip))} of {duration(source.duration)}
        </p>
      </Section>

      <Section
        title="Crop"
        aside={
          clip.crop && (
            <button className="text-button" onClick={() => change({ crop: null })}>
              Reset
            </button>
          )
        }
      >
        <button
          className={`button full ${cropMode ? "on" : ""}`}
          onClick={() => setCropMode(!cropMode)}
          title="Crop  C"
        >
          <CropIcon size={13} /> {cropMode ? "Done" : "Edit crop"}
        </button>
        <Segmented
          value={cropMode ? aspectValue : null}
          options={ASPECTS.map(({ value, label }) => ({ value, label }))}
          onChange={pickAspect}
        />
        <div className="button-row">
          <button className="button" title="Rotate left" aria-label="Rotate left" onClick={() => rotate(-90)}>
            <RotateCcw size={13} />
          </button>
          <button className="button" title="Rotate right" aria-label="Rotate right" onClick={() => rotate(90)}>
            <RotateCw size={13} />
          </button>
          <button
            className={`button ${clip.flipH ? "on" : ""}`}
            title="Flip horizontal"
            aria-label="Flip horizontal"
            onClick={() => change({ flipH: !clip.flipH })}
          >
            <FlipHorizontal2 size={13} />
          </button>
          <button
            className={`button ${clip.flipV ? "on" : ""}`}
            title="Flip vertical"
            aria-label="Flip vertical"
            onClick={() => change({ flipV: !clip.flipV })}
          >
            <FlipVertical2 size={13} />
          </button>
        </div>
      </Section>

      <Section title="Speed" aside={<span className="value">{clip.speed}×</span>}>
        <Segmented
          value={clip.speed}
          options={SPEEDS.map((speed) => ({ value: speed, label: `${speed}` }))}
          onChange={(speed) => change({ speed })}
        />
      </Section>

      <Section
        title="Audio"
        aside={source.hasAudio && <span className="value">{Math.round(clip.volume * 100)}%</span>}
      >
        {source.hasAudio ? (
          <div className="audio-row">
            <button
              className={`icon-button ${clip.muted ? "on" : ""}`}
              title={clip.muted ? "Unmute" : "Mute"}
              aria-label={clip.muted ? "Unmute" : "Mute"}
              onClick={() => change({ muted: !clip.muted })}
            >
              {clip.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <Slider
              label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={clip.volume}
              onStart={checkpoint}
              onChange={(volume) => updateClip(clip.id, { volume })}
            />
          </div>
        ) : (
          <p className="meta">This clip has no audio.</p>
        )}
      </Section>
    </>
  );
}
