import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModalEditor } from "../index.js";
import {
  setInternalCursor,
  stubKeybindings,
  stubTheme,
  stubTui,
} from "./harness.js";
import {
  type NvimParityCase,
  type NvimParitySnapshot,
  runNvimParityCase,
} from "./nvim-oracle.js";

type RenderCase = NvimParityCase & { width: number };
const cases: RenderCase[] = [
  {
    name: "rendered forward visual yank remains inclusive",
    initial: { text: "alpha beta", cursor: { line: 0, col: 0 } },
    keys: ["v", "e", "y"],
    width: 80,
  },
  {
    name: "rendered reverse visual yank keeps the anchor",
    initial: { text: "alpha beta", cursor: { line: 0, col: 4 } },
    keys: ["v", "b", "y"],
    width: 80,
  },
  {
    name: "rendered cross-line selection yanks the same range",
    initial: { text: "abc\ndef", cursor: { line: 0, col: 1 } },
    keys: ["v", "j", "y"],
    width: 20,
  },
  {
    name: "rendered linewise yank includes complete lines",
    initial: { text: "alpha\nbeta\ngamma", cursor: { line: 0, col: 0 } },
    keys: ["V", "j", "y"],
    width: 20,
  },
  {
    name: "rendered empty line in a linewise selection is retained",
    initial: { text: "one\n\nthree", cursor: { line: 0, col: 0 } },
    keys: ["V", "j", "y"],
    width: 20,
  },
  {
    name: "rendered combining and wide graphemes yank whole graphemes",
    initial: { text: "e\u0301界z", cursor: { line: 0, col: 0 } },
    keys: ["v", "l", "y"],
    width: 20,
  },
  {
    name: "rendered emoji selection yanks without splitting its surrogate pair",
    initial: { text: "🙂a z", cursor: { line: 0, col: 0 } },
    keys: ["v", "l", "y"],
    width: 20,
  },
  {
    name: "rendered wrapped charwise selection includes the logical newline",
    initial: {
      text: `${"alpha beta ".repeat(20)}\ntail`,
      cursor: { line: 0, col: 0 },
    },
    keys: ["v", "$", "y"],
    width: 20,
  },
  {
    name: "rendered wrapped linewise wide text copies one logical line",
    initial: { text: `${"界".repeat(12)}z\ntail`, cursor: { line: 0, col: 0 } },
    keys: ["V", "y"],
    width: 6,
  },
  {
    name: "rendered scrolled selection keeps the full linewise range",
    initial: {
      text: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"),
      cursor: { line: 0, col: 0 },
    },
    keys: ["V", "G", "y"],
    width: 20,
  },
  {
    name: "rendered reverse character deletion changes only the selected range",
    initial: { text: "alpha beta", cursor: { line: 0, col: 4 } },
    keys: ["v", "b", "d"],
    width: 20,
  },
  {
    name: "rendered visual change exits highlight and keeps insertion semantics",
    initial: { text: "alpha beta", cursor: { line: 0, col: 0 } },
    keys: ["v", "e", "c", "X", "\x1b"],
    width: 20,
  },
  {
    name: "rendered visual toggle preserves the character range",
    initial: { text: "alpha\nbeta", cursor: { line: 0, col: 0 } },
    keys: ["v", "l", "V", "v", "y"],
    width: 20,
  },
  {
    name: "rendered endpoint swap keeps selection contents",
    initial: { text: "alpha beta", cursor: { line: 0, col: 0 } },
    keys: ["v", "e", "o", "y"],
    width: 20,
  },
];

describe("nvim parity with rendering between visual-mode inputs", () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);
      editor.setClipboardMirrorPolicy("never");
      editor.setClipboardFn(() => {});
      editor.setClipboardReadFn(() => null);
      editor.setText(testCase.initial.text);
      editor.setRegister(testCase.initial.register ?? "");
      editor.handleInput("\x1b");
      setInternalCursor(
        editor,
        testCase.initial.cursor.col,
        testCase.initial.cursor.line,
      );
      editor.focused = true;
      editor.render(testCase.width);
      for (const key of testCase.keys) {
        editor.handleInput(key);
        const before: NvimParitySnapshot = {
          text: editor.getText(),
          cursor: editor.getCursor(),
          mode: editor.getMode(),
          register: editor.getRegister(),
        };
        editor.render(testCase.width);
        editor.render(testCase.width);
        assert.deepEqual(
          {
            text: editor.getText(),
            cursor: editor.getCursor(),
            mode: editor.getMode(),
            register: editor.getRegister(),
          },
          before,
          "rendering must not mutate editing state",
        );
      }
      const nvim = await runNvimParityCase(testCase);
      assert.deepEqual(
        {
          text: editor.getText(),
          cursor: editor.getCursor(),
          mode: editor.getMode(),
          register: editor.getRegister(),
        },
        nvim,
      );
    });
  }
});
