import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModalEditor } from "../index.js";
import { sendKeys, stubKeybindings, stubTheme, stubTui } from "./harness.js";
import { runNvimParityCase } from "./nvim-oracle.js";

const PAYLOADS = [
  { name: "large character payload", text: "payload ".repeat(150) },
  {
    name: "large line payload",
    text: Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"),
  },
];

describe("nvim parity for expanded collapsed-paste undo/redo", () => {
  for (const payload of PAYLOADS) {
    it(`${payload.name} is fully restored by redo`, async () => {
      const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);
      editor.setClipboardMirrorPolicy("never");
      editor.setClipboardReadFn(() => null);
      sendKeys(editor, [
        `\x1b[200~${payload.text}\x1b[201~`,
        "\x1b",
        "u",
        "\x12",
      ]);
      assert.match(editor.getText(), /\[paste #1 /);

      const nvim = await runNvimParityCase({
        name: payload.name,
        initial: { text: "", cursor: { line: 0, col: 0 } },
        keys: ["i", ...payload.text, "\x1b", "u", "\x12"],
      });
      // Pi intentionally displays a collapsed marker where Neovim shows the
      // payload; visible cursor coordinates differ. Compare the submitted
      // content, mode and register. Unit tests cover Pi's marker cursor/IDs.
      assert.equal(editor.getExpandedText(), nvim.text);
      assert.equal(editor.getMode(), nvim.mode);
      assert.equal(editor.getRegister(), nvim.register);
    });
  }
});
