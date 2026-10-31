import { describe, expect, it } from "vitest";
import mockSource from "./mock.ts?raw";
import tauriSource from "./tauri.ts?raw";

const importsLoader = /from\s+["']\.\/(index)?["']|from\s+["']\.["']/;

describe("backend loader", () => {
  // index.ts awaits these with a top-level await, so an import back to it
  // deadlocks module loading and leaves a blank window with no error.
  it.each([
    ["tauri.ts", tauriSource],
    ["mock.ts", mockSource],
  ])("%s doesn't import the loader", (_name, source) => {
    expect(source).not.toMatch(importsLoader);
  });
});
