/** Focused operator-motion timings; PIVIM_ENTRY can select a baseline build. */
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import type { ModalEditor as Editor } from "../index.js";
import { stubKeybindings, stubTheme, stubTui } from "../test/harness.js";

const entry = path.resolve(process.env.PIVIM_ENTRY ?? "index.ts");
const { ModalEditor } = (await import(pathToFileURL(entry).href)) as {
  ModalEditor: typeof Editor;
};
const fixtures = [
  { name: "cw-short", text: "one  two three", keys: ["c", "w"] },
  { name: "cw-4k", text: `${"x".repeat(4096)} next`, keys: ["c", "w"] },
  { name: "ce-4k-control", text: `${"x".repeat(4096)} next`, keys: ["c", "e"] },
  { name: "cw-unicode", text: "é😀 next", keys: ["c", "w"] },
  { name: "dw-newline", text: "one\ntwo three", keys: ["d", "w"] },
  { name: "2dw-newline", text: "one two\nthree four", keys: ["2", "d", "w"] },
  { name: "dw-unicode", text: "😀\nnext word", keys: ["d", "w"] },
];
const metrics: Record<
  string,
  { median: number; p95: number; samples: number[] }
> = {};
for (const fixture of fixtures) {
  const samples: number[] = [];
  for (let sample = 0; sample < 8; sample++) {
    const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);
    editor.setClipboardFn(() => undefined);
    editor.setClipboardReadFn(() => null);
    let total = 0;
    for (let iteration = 0; iteration < 300; iteration++) {
      // Restoration is outside the measured operator command.
      editor.setText(fixture.text);
      editor.handleInput("\x1b");
      editor.handleInput("0");
      const start = performance.now();
      for (const key of fixture.keys) editor.handleInput(key);
      total += performance.now() - start;
    }
    samples.push((total * 1000) / 300);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  metrics[fixture.name] = {
    median: sorted[3] ?? 0,
    p95: sorted[6] ?? 0,
    samples,
  };
}
console.log(
  JSON.stringify(
    { entry, node: process.version, unit: "us/command", metrics },
    null,
    2,
  ),
);
