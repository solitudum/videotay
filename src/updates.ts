import { create } from "zustand";
import { backend } from "./backend";
import type { PendingUpdate } from "./backend/api";
import { useProject } from "./state/project";

export const useUpdate = create<{ ready: PendingUpdate | null; installing: boolean }>(() => ({
  ready: null,
  installing: false,
}));

let checking = false;

/**
 * Downloads any new version in the background, so taking it is only a restart.
 * Nobody asked for the launch check, so only `announce` reports what happened.
 */
export async function checkForUpdate({ announce = false } = {}) {
  const { notify } = useProject.getState();
  const { ready } = useUpdate.getState();
  if (ready) {
    if (announce) notify(`Version ${ready.version} is ready. Restart to update.`);
    return;
  }
  if (checking) return;
  checking = true;
  try {
    const update = await backend.downloadUpdate();
    if (update) useUpdate.setState({ ready: update });
    else if (announce) notify("Videotay is up to date.");
  } catch (error) {
    if (announce) notify(`Couldn't check for updates: ${error}`);
  } finally {
    checking = false;
  }
}

export async function installUpdate() {
  const { ready, installing } = useUpdate.getState();
  const { clips, run, notify } = useProject.getState();
  if (!ready || installing || run.status === "running") return;
  // Edits don't outlive the app, so restarting throws this one away.
  const message = "Restart to update? Your current edit will be lost.";
  if (clips.length > 0 && !(await backend.confirm(message))) return;
  useUpdate.setState({ installing: true });
  try {
    await ready.install();
  } catch (error) {
    useUpdate.setState({ installing: false });
    notify(`Couldn't install the update: ${error}`);
  }
}
