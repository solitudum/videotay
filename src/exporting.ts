import { backend } from "./backend";
import { buildSpec } from "./state/output";
import { useProject } from "./state/project";

export function wireExportEvents() {
  const { setRun } = useProject.getState();
  backend.onProgress(({ stage, fraction }) => {
    setRun({ status: "running", stage, fraction });
  });
  backend.onFinished(({ outcome, error }) => {
    if (outcome) setRun({ status: "done", outcome });
    else if (!error || error.kind === "cancelled") setRun({ status: "idle" });
    else setRun({ status: "failed", error });
  });
}

export async function startExport() {
  const { clips, sources, settings, encoders, run, setRun } = useProject.getState();
  if (clips.length === 0 || run.status === "running") return;
  const first = sources[clips[0].sourceId];
  const stem = first.name.replace(/\.[^.]+$/, "");
  const output = await backend.pickOutput(`${stem}-edit`, settings.format);
  if (!output) return;
  setRun({ status: "running", stage: "Starting", fraction: 0 });
  try {
    await backend.startExport(buildSpec(clips, sources, settings, encoders, output));
  } catch (error) {
    setRun({ status: "failed", error: { kind: "failed", message: String(error) } });
  }
}

export const cancelExport = () => void backend.cancelExport();
