import { useProject, type InspectorTab } from "../state/project";
import { ClipPanel } from "./ClipPanel";
import { Segmented } from "./controls";
import { ExportFooter, ExportPanel } from "./ExportPanel";

const TABS: { value: InspectorTab; label: string }[] = [
  { value: "clip", label: "Clip" },
  { value: "export", label: "Export" },
];

export function Inspector() {
  const tab = useProject((state) => state.inspectorTab);
  const clip = useProject((state) => state.clips.find((c) => c.id === state.selectedId));
  const source = useProject((state) => (clip ? state.sources[clip.sourceId] : undefined));
  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        <Segmented value={tab} options={TABS} onChange={useProject.getState().setInspectorTab} />
      </div>
      <div className="inspector-scroll" key={tab}>
        {tab === "export" ? (
          <ExportPanel />
        ) : clip && source ? (
          <ClipPanel clip={clip} source={source} />
        ) : (
          <p className="meta inspector-empty">Select a clip to crop it or change its speed.</p>
        )}
      </div>
      <ExportFooter />
    </aside>
  );
}
