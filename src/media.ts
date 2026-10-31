import { backend, VIDEO_EXTENSIONS } from "./backend";
import { nextId, useProject } from "./state/project";
import type { Source } from "./types";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Tests whether the webview can actually decode a file. */
function canPlay(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const finish = (result: boolean) => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(false), 8000);
    video.onloadeddata = () => finish(video.videoWidth > 0);
    video.onerror = () => finish(false);
    video.src = url;
  });
}

async function prepare(source: Source) {
  const { patchSource, notify } = useProject.getState();
  const thumbnails = backend
    .thumbnails(source.id, source.path, source.duration)
    .then((thumbs) => patchSource(source.id, { thumbs }))
    .catch(() => {});
  const waveform = source.hasAudio
    ? backend
        .waveform(source.path)
        .then((peaks) => patchSource(source.id, { waveform: peaks }))
        .catch(() => {})
    : Promise.resolve();

  if (!(await canPlay(source.playUrl))) {
    patchSource(source.id, { proxying: true });
    try {
      const playUrl = await backend.proxy(source.id, source.path);
      patchSource(source.id, { playUrl, proxying: false });
    } catch {
      patchSource(source.id, { proxying: false });
      notify(`${source.name} can't be previewed, but it will still export.`);
    }
  }
  await Promise.all([thumbnails, waveform]);
}

export async function importFiles(paths: string[]) {
  const { addSource, appendClip, setImporting, notify } = useProject.getState();
  const videos = paths.filter((path) => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return VIDEO_EXTENSIONS.includes(ext);
  });
  if (videos.length < paths.length) {
    notify(`Skipped ${paths.length - videos.length} file(s) that aren't video.`);
  }

  // Clips land on the timeline in the order they were given.
  setImporting(videos.length);
  const probes = videos.map((path) => backend.probe(path));
  for (let i = 0; i < videos.length; i++) {
    try {
      const info = await probes[i];
      const source: Source = {
        id: nextId("s"),
        path: videos[i],
        name: fileName(videos[i]),
        ...info,
        playUrl: backend.fileUrl(videos[i]),
        proxying: false,
        thumbs: null,
        waveform: null,
      };
      addSource(source);
      appendClip(source);
      void prepare(source);
    } catch (error) {
      notify(`Couldn't import ${fileName(videos[i])}: ${String(error)}`);
    }
    setImporting(-1);
  }
}

export async function pickAndImport() {
  const paths = await backend.pickFiles();
  if (paths.length > 0) await importFiles(paths);
}
