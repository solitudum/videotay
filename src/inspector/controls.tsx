import type { ReactNode } from "react";

export function Section({ title, aside, children }: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** `group` is for several controls: a label would click the first when its text is clicked. */
export function Row({ label, group, children }: {
  label: string;
  group?: boolean;
  children: ReactNode;
}) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="row">
      <span>{label}</span>
      {children}
    </Tag>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: {
  value: T | null;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange(value: T): void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={String(option.value)}
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          className={option.value === value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, min, max, step, onStart, onChange, label }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onStart?(): void;
  onChange(value: number): void;
  label: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      className="slider"
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ "--fill": `${fill}%` } as React.CSSProperties}
      onPointerDown={onStart}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function Select<T extends string | number>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  return (
    <select
      className="select"
      value={String(value)}
      onChange={(event) => {
        const picked = options.find((option) => String(option.value) === event.target.value);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange(on: boolean): void }) {
  return (
    <input
      className="toggle"
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
