import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModalEditor } from "../index.js";
import { sendKeys, stubKeybindings, stubTheme, stubTui } from "./harness.js";

const CHAR_PAYLOAD = "payload ".repeat(150);
const LINE_PAYLOAD = Array.from({ length: 12 }, (_, i) => `line ${i}`).join(
  "\n",
);

function createEditor(): ModalEditor {
  const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);
  editor.setClipboardMirrorPolicy("never");
  editor.setClipboardFn(() => {
    assert.fail("paste safety tests must not write the OS clipboard");
  });
  editor.setClipboardReadFn(() => null);
  return editor;
}

function paste(editor: ModalEditor, text: string): void {
  editor.handleInput(`\x1b[200~${text}\x1b[201~`);
}

function assertExpanded(
  editor: ModalEditor,
  expected: string,
  cursor = editor.getCursor(),
): void {
  assert.equal(editor.getExpandedText(), expected);
  assert.deepEqual(editor.getCursor(), cursor);
  assert.equal(editor.getMode(), "normal");
}

describe("collapsed paste snapshot safety", () => {
  for (const [name, payload] of [
    ["character-count", CHAR_PAYLOAD],
    ["line-count", LINE_PAYLOAD],
  ]) {
    it(`${name} paste survives undo and redo`, () => {
      const editor = createEditor();
      paste(editor, payload);
      sendKeys(editor, ["\x1b"]);
      assert.match(editor.getText(), /\[paste #1 /);
      const visible = editor.getText();
      const cursor = editor.getCursor();
      const register = editor.getRegister();

      for (let i = 0; i < 3; i++) {
        sendKeys(editor, ["u"]);
        assertExpanded(editor, "", { line: 0, col: 0 });
        sendKeys(editor, ["\x12"]);
        assert.equal(editor.getText(), visible);
        assertExpanded(editor, payload, cursor);
        assert.equal(editor.getRegister(), register);
      }
    });
  }

  it("redo restores the paste ID counter before another paste", () => {
    const editor = createEditor();
    paste(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x1b", "u", "\x12", "A", " "]);
    const secondPayload = "different ".repeat(140);
    paste(editor, secondPayload);
    sendKeys(editor, ["\x1b"]);
    assert.match(editor.getText(), /\[paste #1 /);
    assert.match(editor.getText(), /\[paste #2 /);
    assertExpanded(editor, `${CHAR_PAYLOAD} ${secondPayload}`);

    sendKeys(editor, ["u"]);
    assertExpanded(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x12"]);
    assertExpanded(editor, `${CHAR_PAYLOAD} ${secondPayload}`);
  });

  it("motion and counted exhausted history preserve the redo payload", () => {
    const editor = createEditor();
    paste(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x1b", "9", "u", "h", "k", "9", "\x12"]);
    assertExpanded(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x12"]);
    assertExpanded(editor, CHAR_PAYLOAD);
  });

  it("an edit outside a marker leaves its payload intact through undo/redo", () => {
    const editor = createEditor();
    paste(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x1b", "A", " ", "t", "a", "i", "l", "\x1b"]);
    const cursor = editor.getCursor();
    assertExpanded(editor, `${CHAR_PAYLOAD} tail`, cursor);
    sendKeys(editor, ["u"]);
    assertExpanded(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x12"]);
    assertExpanded(editor, `${CHAR_PAYLOAD} tail`, cursor);
  });

  it("a real replacement paste clears stale redo even when its marker looks identical", () => {
    const editor = createEditor();
    paste(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x1b", "u", "i"]);
    const replacement = "another ".repeat(150);
    paste(editor, replacement);
    sendKeys(editor, ["\x1b", "\x12"]);
    assertExpanded(editor, replacement);
    sendKeys(editor, ["u", "\x12"]);
    assertExpanded(editor, replacement);
  });

  it("synchronous EX dispatch restores expanded paste content and history", () => {
    const editor = createEditor();
    paste(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x1b"]);
    const cursor = editor.getCursor();
    const commands: string[] = [];
    editor.setRunCommandFn((command) => {
      commands.push(command);
      editor.setText("");
    });
    sendKeys(editor, [":", "t", "r", "e", "e", "\r"]);
    assert.deepEqual(commands, ["/tree"]);
    assertExpanded(editor, CHAR_PAYLOAD, cursor);
    sendKeys(editor, ["u"]);
    assertExpanded(editor, "");
    sendKeys(editor, ["\x12"]);
    assertExpanded(editor, CHAR_PAYLOAD, cursor);
  });

  it("delayed EX clearing restores the latest paste registry", async () => {
    const editor = createEditor();
    paste(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x1b"]);
    let clearLater: (() => void) | undefined;
    editor.setRunCommandFn(
      () =>
        new Promise<void>((resolve) => {
          clearLater = () => {
            editor.setText("");
            resolve();
          };
        }),
    );
    sendKeys(editor, [":", "t", "r", "e", "e", "\r", "A", " "]);
    const latestPayload = "latest ".repeat(160);
    paste(editor, latestPayload);
    sendKeys(editor, ["\x1b"]);
    const cursor = editor.getCursor();
    assertExpanded(editor, `${CHAR_PAYLOAD} ${latestPayload}`, cursor);
    assert.ok(clearLater);
    clearLater();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assertExpanded(editor, `${CHAR_PAYLOAD} ${latestPayload}`, cursor);
  });

  it("programmatic text replacement cannot resurrect an old paste via redo", () => {
    const editor = createEditor();
    paste(editor, CHAR_PAYLOAD);
    sendKeys(editor, ["\x1b", "u"]);
    editor.setText("new draft");
    sendKeys(editor, ["\x12"]);
    assertExpanded(editor, "new draft");
  });
});
