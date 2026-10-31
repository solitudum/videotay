import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { COMMANDS } from "../commands";
import { shortcutLabel } from "../format";
import { useProject } from "../state/project";

export function Palette() {
  const open = useProject((state) => state.paletteOpen);
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => useProject.getState().setPaletteOpen(false);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return COMMANDS.filter(
      (command) =>
        !command.hidden && words.every((word) => command.title.toLowerCase().includes(word)),
    );
  }, [query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (index: number) => {
    const command = results[index];
    if (!command) return;
    close();
    command.run();
  };

  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <div className="palette" role="dialog" aria-label="Commands" onPointerDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={14} />
          <input
            autoFocus
            placeholder="Type a command"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(active);
              } else if (event.key === "Escape") {
                close();
              }
            }}
          />
        </div>
        <div className="palette-list" ref={list}>
          {results.map((command, index) => (
            <button
              key={command.id}
              className={index === active ? "active" : ""}
              onPointerMove={() => setActive(index)}
              onClick={() => run(index)}
            >
              <span>{command.title}</span>
              {command.keys && <kbd>{shortcutLabel(command.keys)}</kbd>}
            </button>
          ))}
          {results.length === 0 && <p className="meta palette-none">No matching commands</p>}
        </div>
      </div>
    </div>
  );
}
