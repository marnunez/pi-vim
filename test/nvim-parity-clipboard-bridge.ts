import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModalEditor } from "../index.js";
import {
  clipboardRuntimeFixture,
  fixtureClipboardReader,
} from "./clipboard-runtime-fixture.js";
import {
  setInternalCursor,
  stubKeybindings,
  stubTheme,
  stubTui,
} from "./harness.js";
import { type NvimParityCase, runNvimParityCase } from "./nvim-oracle.js";

// The system clipboard is a Pi UI source, not a new Vim register semantic.
// Seed Neovim's unnamed register with the same synthetic clipboard bytes so
// normal put geometry, cursor, counts and history remain comparable.
const cases: NvimParityCase[] = [
  {
    name: "native clipboard bridge charwise p",
    initial: { text: "ab", cursor: { line: 0, col: 0 }, register: "X" },
    keys: ["p"],
  },
  {
    name: "native clipboard bridge counted P",
    initial: { text: "ab", cursor: { line: 0, col: 0 }, register: "X" },
    keys: ["2", "P"],
  },
  {
    name: "native clipboard bridge grapheme p",
    initial: {
      text: "ab",
      cursor: { line: 0, col: 0 },
      register: "界e\u0301🙂",
    },
    keys: ["p"],
  },
  {
    name: "native clipboard bridge linewise p",
    initial: {
      text: "ab",
      cursor: { line: 0, col: 0 },
      register: "  one\ntwo\n",
    },
    keys: ["p"],
  },
];

describe("nvim parity through the native clipboard helper", () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const fixture = clipboardRuntimeFixture({
        utilitySource: `export async function readClipboardText(){return ${JSON.stringify(testCase.initial.register)};}`,
      });
      const writes: string[] = [];
      try {
        const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);
        editor.setClipboardFn((text) => {
          writes.push(text);
        });
        editor.setClipboardReadFn(fixtureClipboardReader(fixture.moduleUrl));
        editor.setClipboardMirrorPolicy("all");
        editor.setText(testCase.initial.text);
        editor.setRegister(testCase.initial.register ?? "");
        editor.handleInput("\x1b");
        setInternalCursor(
          editor,
          testCase.initial.cursor.col,
          testCase.initial.cursor.line,
        );
        for (const key of testCase.keys) editor.handleInput(key);
        const nvim = await runNvimParityCase(testCase);
        // Neovim reports byte columns; Pi reports UTF-16 string offsets.
        const line = nvim.text.split("\n")[nvim.cursor.line] ?? "";
        nvim.cursor.col = Buffer.from(line, "utf8")
          .subarray(0, nvim.cursor.col)
          .toString("utf8").length;
        assert.deepEqual(
          {
            text: editor.getText(),
            cursor: editor.getCursor(),
            mode: editor.getMode(),
            register: editor.getRegister(),
          },
          nvim,
        );
        assert.deepEqual(
          writes,
          [],
          "put must not mirror or overwrite the clipboard",
        );
      } finally {
        fixture.cleanup();
      }
    });
  }
});
