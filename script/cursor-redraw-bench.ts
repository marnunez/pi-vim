/** Terminal-write replay; PIVIM_CURSOR_ENTRY points to a baseline cursor-shape.ts. */
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const entry = resolve(process.env.PIVIM_CURSOR_ENTRY ?? "cursor-shape.ts");
const { enableCursorShapeSupport } = (await import(
  pathToFileURL(entry).href
)) as typeof import("../cursor-shape.js");
const iterations = 20_000;
const rounds = 11;
let consumed = 0;
const terminal = {
  write(data: string) {
    consumed += data.length;
  },
};
const cleanup = enableCursorShapeSupport({
  terminal,
  setShowHardwareCursor() {},
});
const fixtures = {
  "position-only": "\x1b[2A\x1b[3G",
  "status-frame": "\x1b[?2026h\r\x1b[2KPondering...\x1b[?2026l",
  "long-frame": `\x1b[?2026h${"content ".repeat(1000)}\x1b[?2026l`,
  "bounded-chunk": "content ".repeat(8192),
};
const metrics = Object.fromEntries(
  Object.entries(fixtures).map(([name, data]) => {
    for (let i = 0; i < iterations; i++) terminal.write(data);
    const samples = [];
    for (let round = 0; round < rounds; round++) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) terminal.write(data);
      samples.push(((performance.now() - start) * 1000) / iterations);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    return [
      name,
      { unit: "us/write", samples, median: sorted[5], p95: sorted[9] },
    ];
  }),
);
cleanup?.();
console.log(
  JSON.stringify(
    { entry, node: process.version, iterations, rounds, consumed, metrics },
    null,
    2,
  ),
);
