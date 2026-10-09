import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEditorWithSpy, sendKeys, setInternalCursor } from "./harness.js";

function setup(text: string, col = 0, line = 0) {
  const result = createEditorWithSpy("");
  result.editor.setText(text);
  setInternalCursor(result.editor, col, line);
  return result;
}

const ESC = "\x1b";

describe("motion correctness regressions", () => {
  it("cw preserves whitespace, mode, cursor, register and undo/redo state", () => {
    const { editor } = setup("one  two");
    sendKeys(editor, ["c", "w"]);
    assert.equal(editor.getText(), "  two");
    assert.equal(editor.getRegister(), "one");
    assert.equal(editor.getMode(), "insert");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
    sendKeys(editor, ["X", ESC, "u"]);
    assert.equal(editor.getText(), "one  two");
    sendKeys(editor, ["\x12"]);
    assert.equal(editor.getText(), "X  two");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  });

  for (const motion of ["w", "W"]) {
    for (const fixture of [
      { text: "a\nb", col: 0, count: 2, register: "a\nb", remaining: "" },
      {
        text: "one\ntwo",
        col: 2,
        count: 2,
        register: "e\ntwo",
        remaining: "on",
      },
      { text: "a b", col: 0, count: 3, register: "a b", remaining: "" },
      {
        text: "one\ntwo",
        col: 2,
        count: 99999,
        register: "e\ntwo",
        remaining: "on",
      },
      { text: "a\nb\nc", col: 0, count: 2, register: "a\nb", remaining: "\nc" },
    ]) {
      it(`counted c${motion} fallback consumes the current end (${JSON.stringify(fixture.text)}, ${fixture.count})`, () => {
        const { editor } = setup(fixture.text, fixture.col);
        sendKeys(editor, [...String(fixture.count), "c", motion]);
        assert.equal(editor.getText(), fixture.remaining);
        assert.equal(editor.getRegister(), fixture.register);
        assert.equal(editor.getMode(), "insert");
        assert.deepEqual(editor.getCursor(), { line: 0, col: fixture.col });
        sendKeys(editor, ["X", ESC]);
        const changed = `${fixture.remaining.slice(0, fixture.col)}X${fixture.remaining.slice(fixture.col)}`;
        assert.equal(editor.getText(), changed);
        assert.equal(editor.getMode(), "normal");
        sendKeys(editor, ["u"]);
        assert.equal(editor.getText(), fixture.text);
        sendKeys(editor, ["\x12"]);
        assert.equal(editor.getText(), changed);
        assert.equal(editor.getRegister(), fixture.register);
        assert.deepEqual(editor.getCursor(), { line: 0, col: fixture.col });
        sendKeys(editor, ["0", "x"]);
        assert.equal(
          editor.getText(),
          changed.slice(1),
          "change count must not leak to x",
        );
      });
    }
    it(`d${motion} trims the terminal newline on a wrapped logical line`, () => {
      const prefix = "x".repeat(160);
      const { editor } = setup(
        `${prefix} end  \n  next word`,
        prefix.length + 1,
      );
      editor.render(20);
      sendKeys(editor, ["d", motion]);
      assert.equal(editor.getText(), `${prefix} \n  next word`);
      assert.equal(editor.getRegister(), "end  ");
      assert.equal(editor.getMode(), "normal");
      assert.deepEqual(editor.getCursor(), { line: 0, col: prefix.length });
    });
    it(`2d${motion} whole-line deletion preserves linewise put and history`, () => {
      const { editor } = setup("a\nb\ntailword");
      sendKeys(editor, ["2", "d", motion]);
      assert.equal(editor.getText(), "tailword");
      assert.equal(editor.getRegister(), "a\nb\n");
      assert.equal(editor.getMode(), "normal");
      assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
      sendKeys(editor, ["u"]);
      assert.equal(editor.getText(), "a\nb\ntailword");
      sendKeys(editor, ["\x12"]);
      assert.equal(editor.getText(), "tailword");
      assert.equal(editor.getRegister(), "a\nb\n");
      assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
      sendKeys(editor, ["l"]);
      assert.deepEqual(
        editor.getCursor(),
        { line: 0, col: 1 },
        "delete count must not leak",
      );
      sendKeys(editor, ["p"]);
      assert.equal(editor.getText(), "tailword\na\nb");
      assert.equal(editor.getRegister(), "a\nb\n");
      assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
    });
    it(`d${motion} on an empty line excludes the empty EOF endpoint`, () => {
      const { editor } = setup("a\n\n", 0, 1);
      sendKeys(editor, ["d", motion]);
      assert.equal(editor.getText(), "a\n");
      assert.equal(editor.getRegister(), "\n");
      assert.equal(editor.getMode(), "normal");
      assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
      sendKeys(editor, ["u"]);
      assert.equal(editor.getText(), "a\n\n");
      sendKeys(editor, ["\x12"]);
      assert.equal(editor.getText(), "a\n");
      assert.equal(editor.getRegister(), "\n");
      assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
      sendKeys(editor, ["p"]);
      assert.equal(editor.getText(), "a\n\n");
      assert.equal(editor.getRegister(), "\n");
      assert.deepEqual(editor.getCursor(), { line: 2, col: 0 });
    });
    it(`3d${motion} exhausted at an empty EOF keeps exactly one separator newline`, () => {
      const { editor } = setup("a b\n");
      sendKeys(editor, ["3", "d", motion]);
      assert.equal(editor.getText(), "");
      assert.equal(editor.getRegister(), "a b\n");
      assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
      sendKeys(editor, ["u"]);
      assert.equal(editor.getText(), "a b\n");
      sendKeys(editor, ["\x12"]);
      assert.equal(editor.getText(), "");
      assert.equal(editor.getRegister(), "a b\n");
      assert.equal(editor.getMode(), "normal");
    });
    it(`2d${motion} keeps intermediate newlines in its register`, () => {
      const { editor } = setup("one\ntwo three");
      sendKeys(editor, ["2", "d", motion]);
      assert.equal(editor.getText(), "three");
      assert.equal(editor.getRegister(), "one\ntwo ");
      assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
      sendKeys(editor, ["u"]);
      assert.equal(editor.getText(), "one\ntwo three");
    });
  }

  it("normal h/l count clamp stays on the logical line, including wrapped Unicode", () => {
    const text = `${"x".repeat(160)}é👩‍💻z\nnext`;
    const { editor } = setup(text);
    editor.render(20);
    sendKeys(editor, ["9", "9", "9", "l"]);
    assert.deepEqual(editor.getCursor(), { line: 0, col: 167 });
    sendKeys(editor, ["h"]);
    assert.deepEqual(editor.getCursor(), { line: 0, col: 162 });
    sendKeys(editor, ["h"]);
    assert.deepEqual(editor.getCursor(), { line: 0, col: 160 });
    sendKeys(editor, ["9", "9", "9", "h", "h"]);
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
    assert.equal(editor.getText(), text);
    setInternalCursor(editor, 0, 1);
    sendKeys(editor, ["h"]);
    assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
  });

  it("normal no-op boundaries do not replace the register or undo entry", () => {
    const { editor } = setup("abc\nnext");
    sendKeys(editor, ["x", "$", "9", "l"]);
    assert.equal(editor.getRegister(), "a");
    assert.equal(editor.getText(), "bc\nnext");
    sendKeys(editor, ["u"]);
    assert.equal(editor.getText(), "abc\nnext");
  });

  it("insert and visual h/l still allow their existing EOL boundary", () => {
    const { editor } = setup("abc\nnext");
    sendKeys(editor, ["$", "a", "h", "l", ESC]);
    assert.equal(editor.getText(), "abchl\nnext");
    sendKeys(editor, ["$", "v", "l"]);
    assert.equal(editor.getMode(), "visual");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 5 });
  });

  for (const op of ["d", "c", "y"]) {
    it(`${op}l operates on complete Unicode graphemes and maintains charwise register`, () => {
      const { editor } = setup("é👩‍💻z\nnext", 2);
      sendKeys(editor, [op, "l"]);
      assert.equal(editor.getRegister(), "👩‍💻");
      assert.equal(editor.getText(), op === "y" ? "é👩‍💻z\nnext" : "éz\nnext");
      assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
      assert.equal(editor.getMode(), op === "c" ? "insert" : "normal");
    });
    it(`${op}h no-op consumes its count and applies Vim's empty-range register rule`, () => {
      const { editor, clipboardWrites } = setup("abc\nnext");
      editor.setRegister("seed");
      sendKeys(editor, ["9", op, "h"]);
      assert.equal(editor.getText(), "abc\nnext");
      assert.equal(editor.getRegister(), op === "y" ? "" : "seed");
      assert.deepEqual(clipboardWrites, []);
      assert.equal(editor.getMode(), op === "c" ? "insert" : "normal");
      if (op === "c") sendKeys(editor, [ESC]);
      sendKeys(editor, ["l"]);
      assert.deepEqual(editor.getCursor(), { line: 0, col: 1 });
    });
  }

  it("horizontal delete undo/redo and dot repeat preserve multiplied counts", () => {
    const { editor } = setup("abcdefghij");
    sendKeys(editor, ["2", "d", "2", "l"]);
    assert.equal(editor.getText(), "efghij");
    assert.equal(editor.getRegister(), "abcd");
    sendKeys(editor, ["u"]);
    assert.equal(editor.getText(), "abcdefghij");
    sendKeys(editor, ["\x12"]);
    assert.equal(editor.getText(), "efghij");
    sendKeys(editor, ["."]);
    assert.equal(editor.getText(), "ij");
    assert.equal(editor.getRegister(), "efgh");
  });

  it("yl mirror writes exactly the charwise payload", async () => {
    const { editor, clipboardWrites } = setup("abc");
    editor.setClipboardMirrorPolicy("all");
    sendKeys(editor, ["y", "l"]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(clipboardWrites, ["a"]);
    sendKeys(editor, ["2", "p"]);
    assert.equal(editor.getText(), "aaabc");
  });
});
