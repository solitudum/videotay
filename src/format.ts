const pad = (value: number) => String(value).padStart(2, "0");

/** Formats as mm:ss.ff, where ff is frames at the given rate. */
export function timecode(seconds: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const total = Math.round(Math.max(0, seconds) * rate);
  const frames = total % rate;
  const whole = Math.floor(total / rate);
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}.${pad(frames)}`;
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  return `${Math.floor(seconds / 60)}:${pad(Math.floor(seconds % 60))}`;
}

export function bytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(value / 1000))} KB`;
}

const isMac = /Mac/.test(navigator.userAgent);
export const platformIsMac = isMac;

/** Turns "mod+shift+Z" into the platform's way of writing a shortcut. */
export function shortcutLabel(keys: string): string {
  const parts = keys.split("+");
  if (isMac) {
    return parts
      .map((part) => ({ mod: "⌘", shift: "⇧", alt: "⌥", Backspace: "⌫" })[part] ?? part)
      .join("");
  }
  return parts
    .map((part) => ({ mod: "Ctrl", shift: "Shift", alt: "Alt", Backspace: "Del" })[part] ?? part)
    .join("+");
}
