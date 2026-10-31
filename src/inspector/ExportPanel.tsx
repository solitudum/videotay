import { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { backend } from "../backend";
import { cancelExport, startExport } from "../exporting";
import { bytes, shortcutLabel } from "../format";
import {
  canvasSize,
  CODEC_LABEL,
  CODECS_FOR,
  DEFAULT_CRF,
  hardwareEncoder,
  MAX_CRF,
  outputFps,
  planForLimit,
  RESOLUTION_PRESETS,
  SOFTWARE_ENCODER,
} from "../state/output";
import { useProject } from "../state/project";
import type { Codec, ExportSettings, Format } from "../types";
import { Row, Section, Segmented, Select, Slider, Toggle } from "./controls";

const LIMITS = [10, 25, 50, 100];

/** A size field that only commits valid numbers, and tolerates typing "1." */
function MbField({ value, onChange }: { value: number; onChange(value: number): void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]); // eslint-disable-line
  return (
    <div className="mb-field">
      <input
        aria-label="Maximum size in megabytes"
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = Number(event.target.value);
          if (parsed > 0) onChange(parsed);
        }}
      />
      <span>MB</span>
    </div>
  );
}

function SizeLimit({ settings }: { settings: ExportSettings }) {
  const { updateSettings } = useProject.getState();
  return (
    <div className="limit">
      <Segmented
        value={settings.maxMb}
        options={LIMITS.map((mb) => ({ value: mb, label: `${mb}` }))}
        onChange={(maxMb) => updateSettings({ maxMb })}
      />
      <MbField value={settings.maxMb} onChange={(maxMb) => updateSettings({ maxMb })} />
    </div>
  );
}

function VideoOptions({ settings }: { settings: ExportSettings }) {
  const clips = useProject((state) => state.clips);
  const sources = useProject((state) => state.sources);
  const encoders = useProject((state) => state.encoders);
  const { updateSettings } = useProject.getState();

  const codecs = CODECS_FOR[settings.format].filter(
    (codec) => encoders.length === 0 || encoders.includes(SOFTWARE_ENCODER[codec]),
  );
  const plan = planForLimit(clips, sources, settings);
  const hardware = hardwareEncoder(settings.codec, encoders);
  const canvas = canvasSize(clips, sources, { ...settings, resolution: "source" });
  const short = Math.min(canvas.width, canvas.height);

  const setCodec = (codec: Codec) => updateSettings({ codec, crf: DEFAULT_CRF[codec] });

  return (
    <>
      <Row label="Codec" group>
        <Segmented
          value={settings.codec}
          options={codecs.map((codec) => ({ value: codec, label: CODEC_LABEL[codec] }))}
          onChange={setCodec}
        />
      </Row>
      <Row label="Size" group>
        <Segmented
          value={settings.sizeMode}
          options={[
            { value: "quality" as const, label: "Quality" },
            { value: "max" as const, label: "Max size" },
          ]}
          onChange={(sizeMode) => updateSettings({ sizeMode })}
        />
      </Row>

      {settings.sizeMode === "quality" ? (
        <Row label={`CRF ${settings.crf}`}>
          <Slider
            label="Quality (CRF). Lower is better and larger."
            min={10}
            max={MAX_CRF[settings.codec]}
            step={1}
            value={settings.crf}
            onChange={(crf) => updateSettings({ crf })}
          />
        </Row>
      ) : (
        <>
          <SizeLimit settings={settings} />
          {plan && <p className="meta">About {plan.videoKbps.toLocaleString()} kbps for video</p>}
          {plan?.tooLow && (
            <div className="warning">
              <AlertTriangle size={13} />
              <div>
                <p>This limit is low for the resolution, so it may look rough.</p>
                {plan.suggestedResolution && (
                  <button
                    className="text-button"
                    onClick={() => updateSettings({ resolution: plan.suggestedResolution! })}
                  >
                    Use {plan.suggestedResolution}p
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <Row label="Resolution">
        <Select
          value={settings.resolution}
          options={[
            {
              value: "source" as const,
              label: canvas.width > 0 ? `Source (${canvas.width}×${canvas.height})` : "Source",
            },
            ...RESOLUTION_PRESETS.filter((preset) => preset < short).map((preset) => ({
              value: preset as number,
              label: `${preset}p`,
            })),
          ]}
          onChange={(resolution) => updateSettings({ resolution })}
        />
      </Row>
      <Row label="Frame rate">
        <Select
          value={settings.fps}
          options={[
            { value: "source" as const, label: "Source" },
            ...[60, 30, 24, 15].map((fps) => ({ value: fps as number, label: `${fps} fps` })),
          ]}
          onChange={(fps) => updateSettings({ fps })}
        />
      </Row>
      <Row label="Audio">
        <Select
          value={settings.audioKbps ?? 0}
          options={[
            { value: 0, label: "None" },
            ...[96, 128, 192, 320].map((kbps) => ({ value: kbps, label: `${kbps} kbps` })),
          ]}
          onChange={(kbps) => updateSettings({ audioKbps: kbps === 0 ? null : kbps })}
        />
      </Row>
      {hardware && settings.sizeMode === "quality" && (
        <Row label="Hardware">
          <Toggle checked={settings.hardware} onChange={(on) => updateSettings({ hardware: on })} />
        </Row>
      )}
    </>
  );
}

function GifOptions({ settings }: { settings: ExportSettings }) {
  const { updateSettings } = useProject.getState();
  const limited = settings.sizeMode === "max";
  return (
    <>
      <Row label="Width">
        <Select
          value={settings.gifWidth}
          options={[1080, 720, 640, 480, 360, 240].map((width) => ({
            value: width,
            label: `${width} px`,
          }))}
          onChange={(gifWidth) => updateSettings({ gifWidth })}
        />
      </Row>
      <Row label="Frame rate">
        <Select
          value={settings.gifFps}
          options={[30, 24, 20, 15, 12, 10].map((fps) => ({ value: fps, label: `${fps} fps` }))}
          onChange={(gifFps) => updateSettings({ gifFps })}
        />
      </Row>
      <Row label="Colors">
        <Select
          value={settings.gifColors}
          options={[256, 128, 64, 32, 16].map((colors) => ({ value: colors, label: `${colors}` }))}
          onChange={(gifColors) => updateSettings({ gifColors })}
        />
      </Row>
      <Row label="Dither">
        <Select
          value={settings.gifDither}
          options={[
            { value: "sierra2_4a", label: "Smooth" },
            { value: "bayer", label: "Pattern" },
            { value: "none", label: "None" },
          ]}
          onChange={(gifDither) => updateSettings({ gifDither })}
        />
      </Row>
      <Row label="Loop">
        <Toggle checked={settings.gifLoop} onChange={(gifLoop) => updateSettings({ gifLoop })} />
      </Row>
      <Row label="Size limit">
        <Toggle
          checked={limited}
          onChange={(on) => updateSettings({ sizeMode: on ? "max" : "quality" })}
        />
      </Row>
      {limited && (
        <>
          <SizeLimit settings={settings} />
          <p className="meta">Keeps the largest width that fits the limit.</p>
        </>
      )}
    </>
  );
}

export function ExportPanel() {
  const settings = useProject((state) => state.settings);
  const { updateSettings } = useProject.getState();

  const setFormat = (format: Format) => {
    if (format === "gif") return updateSettings({ format });
    const codec = CODECS_FOR[format].includes(settings.codec)
      ? settings.codec
      : CODECS_FOR[format][0];
    updateSettings({ format, codec, crf: DEFAULT_CRF[codec] });
  };

  return (
    <Section title="Format">
      <Segmented
        value={settings.format}
        options={[
          { value: "mp4" as const, label: "MP4" },
          { value: "webm" as const, label: "WebM" },
          { value: "gif" as const, label: "GIF" },
        ]}
        onChange={setFormat}
      />
      {settings.format === "gif" ? (
        <GifOptions settings={settings} />
      ) : (
        <VideoOptions settings={settings} />
      )}
    </Section>
  );
}

export function ExportFooter() {
  const run = useProject((state) => state.run);
  const clips = useProject((state) => state.clips);
  const sources = useProject((state) => state.sources);
  const settings = useProject((state) => state.settings);
  const { setRun } = useProject.getState();

  if (run.status === "running") {
    return (
      <footer className="export-footer">
        <div className="progress-head">
          <span>{run.stage}</span>
          <span className="value">{Math.round(run.fraction * 100)}%</span>
        </div>
        <div className="progress"><i style={{ width: `${run.fraction * 100}%` }} /></div>
        <button className="button full" onClick={cancelExport}>Cancel</button>
      </footer>
    );
  }

  const canvas = canvasSize(clips, sources, settings);
  const fps = clips.length > 0 ? outputFps(clips, sources, settings) : 0;

  return (
    <footer className="export-footer">
      {run.status === "done" && (
        <div className="result">
          <Check size={13} />
          <span>Saved · {bytes(run.outcome.bytes)} · {run.outcome.width}×{run.outcome.height}</span>
          <button className="text-button" onClick={() => void backend.reveal(run.outcome.path)}>
            Show
          </button>
          <button className="icon-button small" aria-label="Dismiss" onClick={() => setRun({ status: "idle" })}>
            <X size={12} />
          </button>
        </div>
      )}
      {run.status === "failed" && (
        <div className="result failed">
          <AlertTriangle size={13} />
          <span>
            {run.error.kind === "tooSmall"
              ? `Couldn't fit ${bytes(run.error.limitBytes)}. The smallest result was ${bytes(run.error.smallestBytes)}, so no file was saved. Try a lower resolution or frame rate.`
              : run.error.message}
          </span>
          <button className="icon-button small" aria-label="Dismiss" onClick={() => setRun({ status: "idle" })}>
            <X size={12} />
          </button>
        </div>
      )}
      {clips.length > 0 && (
        <p className="meta center">{canvas.width}×{canvas.height} · {fps} fps</p>
      )}
      <button
        className="button primary full"
        disabled={clips.length === 0}
        title={`Export  ${shortcutLabel("mod+E")}`}
        onClick={() => void startExport()}
      >
        Export {settings.format === "gif" ? "GIF" : settings.format.toUpperCase()}
      </button>
    </footer>
  );
}
