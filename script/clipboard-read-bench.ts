/** Synthetic clipboard read replay; never reads/writes the desktop clipboard. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { clipboardRuntimeFixture } from "../test/clipboard-runtime-fixture.js";

const entry = resolve(
  process.env.PIVIM_CLIPBOARD_ENTRY ?? "clipboard-mirror.ts",
);
const { buildClipboardReadHelperSource } = (await import(
  pathToFileURL(entry).href
)) as typeof import("../clipboard-mirror.js");
const rounds = 11;
const iterations = 5;
const metrics = {} as Record<string, unknown>;
for (const [name, text] of [
  ["short-text", "copied text"],
  ["unicode-lines", "界 e\u0301 🙂\nsecond line\n"],
]) {
  const fixture = clipboardRuntimeFixture({
    utilitySource: `export async function readClipboardText(){return ${JSON.stringify(text)};}`,
    legacySource: `module.exports={hasText:async()=>true,getText:async()=>${JSON.stringify(text)}};`,
  });
  try {
    const source = buildClipboardReadHelperSource(fixture.moduleUrl);
    const run = () => {
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", source],
        {
          encoding: "utf8",
          timeout: 750,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            DISPLAY: "",
            WAYLAND_DISPLAY: "",
            XDG_RUNTIME_DIR: "/nonexistent/pi-vim-test",
            PATH: "",
          },
        },
      );
      if (result.status !== 0 || result.stdout !== text)
        throw new Error(`Synthetic read failed: ${name}`);
    };
    for (let i = 0; i < 5; i++) run();
    const samples = [];
    for (let round = 0; round < rounds; round++) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) run();
      samples.push((performance.now() - start) / iterations);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    metrics[name] = {
      unit: "ms/read",
      samples,
      median: sorted[5],
      p95: sorted[9],
    };
  } finally {
    fixture.cleanup();
  }
}
console.log(
  JSON.stringify(
    { entry, node: process.version, iterations, rounds, metrics },
    null,
    2,
  ),
);
