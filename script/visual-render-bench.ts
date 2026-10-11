/** Render replay; run with PIVIM_ENTRY=/path/to/baseline/index.ts for comparison. */

import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { Theme } from "@earendil-works/pi-coding-agent";
import {
  setInternalCursor,
  stubKeybindings,
  stubTheme,
  stubTui,
} from "../test/harness.js";

const entry = resolve(process.env.PIVIM_ENTRY ?? "index.ts");
const { ModalEditor } = (await import(
  pathToFileURL(entry).href
)) as typeof import("../index.js");
const { buildModeColorizers, resolveModeColors } = (await import(
  pathToFileURL(resolve(dirname(entry), "mode-colors.ts")).href
)) as typeof import("../mode-colors.js");
const iterations = 120;
const rounds = 11;
let consumed = 0;

type Fixture = {
  name: string;
  text: string;
  keys: string[];
  width: number;
  alternateWidth?: number;
  replay?: string;
  paste?: string;
  insert?: boolean;
};

const fixtures: Fixture[] = [
  { name: "normal-short-80", text: "alpha beta gamma", keys: [], width: 80 },
  {
    name: "insert-long-80",
    text: "alpha beta ".repeat(400),
    keys: [],
    width: 80,
    insert: true,
  },
  {
    name: "visual-short-80",
    text: "alpha beta gamma",
    keys: ["v", "e"],
    width: 80,
  },
  {
    name: "visual-moving-80",
    text: "alpha beta gamma",
    keys: ["v", "e"],
    width: 80,
    replay: "o",
  },
  {
    name: "visual-long-wrap-80",
    text: "alpha beta ".repeat(400),
    keys: ["v", "$"],
    width: 80,
  },
  {
    name: "visual-resize-20-80",
    text: "alpha beta ".repeat(400),
    keys: ["v", "$"],
    width: 20,
    alternateWidth: 80,
  },
  {
    name: "visual-unicode-wrap-20",
    text: "界 e\u0301 🙂 ".repeat(300),
    keys: ["v", "$"],
    width: 20,
  },
  {
    name: "vline-scroll-80",
    text: Array.from({ length: 400 }, (_, i) => `line ${i} content`).join("\n"),
    keys: ["V", "G"],
    width: 80,
  },
  {
    name: "visual-collapsed-paste-20",
    text: "before ",
    paste: "payload line\n".repeat(500),
    keys: ["v", "$"],
    width: 20,
  },
];

const selectionTheme = new Theme(
  {
    muted: "#908caa",
    text: "#e0def4",
    thinkingXhigh: "#eb6f92",
    borderMuted: "#26233a",
    borderAccent: "#c4a7e7",
    customMessageLabel: "#9ccfd8",
    warning: "#f6c177",
  } as ConstructorParameters<typeof Theme>[0],
  { selectedBg: "#2a2d35" } as ConstructorParameters<typeof Theme>[1],
  "truecolor",
);

function createEditor(fixture: Fixture) {
  const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings, {
    selectionBackground: (s) => selectionTheme.bg("selectedBg", s),
    labelColorizers: buildModeColorizers(
      selectionTheme,
      resolveModeColors(),
      (s) => `\x1b[7m${s}\x1b[27m`,
    ),
  });
  editor.setClipboardMirrorPolicy("never");
  editor.setClipboardFn(() => {});
  editor.setClipboardReadFn(() => null);
  editor.setText(fixture.text);
  if (fixture.paste) {
    setInternalCursor(editor, fixture.text.length, 0);
    editor.handleInput(`\x1b[200~${fixture.paste}\x1b[201~`);
  }
  if (!fixture.insert) editor.handleInput("\x1b");
  setInternalCursor(editor, 0, 0);
  for (const key of fixture.keys) editor.handleInput(key);
  return editor;
}

function measure(fixture: Fixture) {
  const editor = createEditor(fixture);
  const render = (i: number) => {
    if (fixture.replay) editor.handleInput(fixture.replay);
    const width =
      fixture.alternateWidth && i % 2 ? fixture.alternateWidth : fixture.width;
    const lines = editor.render(width);
    consumed += lines[1]?.length ?? 0;
  };
  for (let i = 0; i < 80; i++) render(i);
  const text = editor.getText();
  const expanded = editor.getExpandedText();
  const register = editor.getRegister();
  const samples: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) render(i);
    samples.push(((performance.now() - start) * 1000) / iterations);
  }
  if (
    editor.getText() !== text ||
    editor.getExpandedText() !== expanded ||
    editor.getRegister() !== register
  ) {
    throw new Error(`Render replay mutated editing state: ${fixture.name}`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { unit: "us/frame", samples, median: sorted[5], p95: sorted[9] };
}

const metrics = Object.fromEntries(
  fixtures.map((fixture) => [fixture.name, measure(fixture)]),
);
console.log(
  JSON.stringify(
    {
      entry,
      node: process.version,
      iterations,
      rounds,
      consumed,
      metrics,
    },
    null,
    2,
  ),
);
