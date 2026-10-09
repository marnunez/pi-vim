/** Bounded ASCII motion comparison against Neovim and an older checkout. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  setInternalCursor,
  stubKeybindings,
  stubTheme,
  stubTui,
} from "../test/harness.js";
import {
  type NvimParityCase,
  runNvimParityCase,
  runPiParityCase,
} from "../test/nvim-oracle.js";

async function main(): Promise<void> {
  const baselineArg = process.argv[2];
  if (!baselineArg) {
    console.error(
      "Usage: npm run test:differential -- /path/to/baseline-checkout",
    );
    process.exitCode = 2;
    return;
  }
  const baselineRepo = resolve(baselineArg);
  const { ModalEditor: Old } = (await import(
    pathToFileURL(resolve(baselineRepo, "index.ts")).href
  )) as typeof import("../index.js");

  const originalFixtures = [
    { text: "a\nb", line: 0, col: 0, count: 2, op: "c" },
    { text: "a b", line: 0, col: 0, count: 3, op: "c" },
    { text: "a\nb\nc", line: 0, col: 0, count: 2, op: "d" },
    { text: "a b\n", line: 0, col: 0, count: 3, op: "d" },
    { text: "a\n\n", line: 1, col: 0, count: 1, op: "d" },
    { text: "a\n\n", line: 0, col: 0, count: 2, op: "d" },
  ];
  let originalCases = 0;
  let originalFailures = 0;
  for (const fixture of originalFixtures) {
    for (const motion of ["w", "W"]) {
      const testCase: NvimParityCase = {
        name: "original-finding",
        initial: {
          text: fixture.text,
          cursor: { line: fixture.line, col: fixture.col },
          register: "seed",
        },
        keys: [
          ...(fixture.count === 1 ? [] : [String(fixture.count)]),
          fixture.op,
          motion,
          ...(fixture.op === "c" ? ["X", "\x1b"] : []),
        ],
      };
      originalCases++;
      try {
        const current = runPiParityCase(testCase);
        const nvim = await runNvimParityCase(testCase);
        if (!isDeepStrictEqual(current, nvim)) {
          originalFailures++;
          console.log(
            JSON.stringify({
              kind: "original-failure",
              testCase,
              current,
              nvim,
            }),
          );
        }
      } catch (error) {
        originalFailures++;
        console.log(
          JSON.stringify({
            kind: "original-oracle-error",
            testCase,
            error: String(error),
          }),
        );
      }
    }
  }

  const texts = [
    "a b",
    "a b\nc d",
    "ab\n\ncd ef",
    "a\n\n\nb",
    "  a\nb c",
    "a   \nb c",
    "a\n  \nb c",
    "a b\n",
    "a\n\n",
    "a\n b",
    "ab.cd ef",
    "ab cd\n  ef gh",
    "a\n\n\n",
    "\na b",
    "a\nb\nc",
  ];
  const cases: NvimParityCase[] = [];
  for (const text of texts) {
    const lines = text.split("\n");
    for (let line = 0; line < lines.length; line++) {
      for (const col of new Set([0, Math.max(0, lines[line].length - 1)])) {
        for (const op of ["d", "c"]) {
          for (const motion of ["w", "W"]) {
            for (const count of [1, 2, 3]) {
              cases.push({
                name: "probe",
                initial: { text, cursor: { line, col }, register: "seed" },
                keys: [
                  ...(count === 1 ? [] : [String(count)]),
                  op,
                  motion,
                  ...(op === "c" ? ["X", "\x1b"] : []),
                ],
              });
            }
          }
        }
      }
    }
  }
  assert.equal(cases.length, 636);

  function runBaseline(testCase: NvimParityCase) {
    const editor = new Old(stubTui, stubTheme, stubKeybindings);
    editor.setClipboardMirrorPolicy("never");
    editor.setClipboardReadFn(() => null);
    editor.setText(testCase.initial.text);
    editor.setRegister("seed");
    editor.handleInput("\x1b");
    setInternalCursor(
      editor,
      testCase.initial.cursor.col,
      testCase.initial.cursor.line,
    );
    for (const key of testCase.keys) editor.handleInput(key);
    return {
      text: editor.getText(),
      cursor: editor.getCursor(),
      mode: editor.getMode(),
      register: editor.getRegister(),
    };
  }

  let index = 0;
  let total = 0;
  let introduced = 0;
  let errors = 0;
  let otherMismatches = 0;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (index < cases.length) {
        const testCase = cases[index++];
        const current = runPiParityCase(testCase);
        let nvim: Awaited<ReturnType<typeof runNvimParityCase>>;
        try {
          nvim = await runNvimParityCase(testCase);
        } catch (error) {
          errors++;
          console.log(
            JSON.stringify({
              kind: "oracle-error",
              testCase,
              error: String(error),
            }),
          );
          continue;
        }
        total++;
        if (!isDeepStrictEqual(current, nvim)) {
          const baseline = runBaseline(testCase);
          if (isDeepStrictEqual(baseline, nvim)) {
            introduced++;
            console.log(
              JSON.stringify({
                kind: "introduced",
                testCase,
                current,
                nvim,
                baseline,
              }),
            );
          } else {
            otherMismatches++;
          }
        }
      }
    }),
  );
  console.log(
    JSON.stringify({
      baselineRepo,
      originalCases,
      originalFailures,
      cases: cases.length,
      total,
      introduced,
      errors,
      otherMismatches,
    }),
  );
  if (originalFailures || introduced || errors) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
