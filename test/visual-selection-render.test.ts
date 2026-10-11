import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CustomEditor, Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import installPiVim, { ModalEditor } from "../index.js";
import { setPiVimSettingsReaderForTests } from "../settings.js";
import { highlightCells } from "../visual-selection-render.js";
import {
  createCursorShapeTui,
  createExtensionApiHarness,
  createMultiLineEditor,
  sendKeys,
  setInternalCursor,
  stubKeybindings,
  stubTheme,
} from "./harness.js";

/* eslint-disable no-control-regex -- Inspect observable terminal ANSI state. */
const ansi =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI terminal sequences.
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]_]([^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g;
/* eslint-enable no-control-regex */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const plain = (text: string) => text.replace(ansi, "");

type Cell = {
  text: string;
  inverse: boolean;
  foreground: string;
  background: string;
  bold: boolean;
  underline: boolean;
  link: string;
};
/** Independent terminal-state observer. Wide graphemes occupy two cells. */
function cells(text: string): Cell[] {
  const result: Cell[] = [];
  let inverse = false;
  let foreground = "default";
  let background = "default";
  let bold = false;
  let underline = false;
  let link = "";
  let position = 0;
  for (const match of text.matchAll(ansi)) {
    emit(text.slice(position, match.index));
    const code = match[0];
    if (code.startsWith("\x1b[") && code.endsWith("m")) {
      const params = code.slice(2, -1).split(";");
      for (let i = 0; i < params.length; i++) {
        const n = Number(params[i].split(":")[0]);
        if (n === 0) {
          inverse = false;
          foreground = "default";
          background = "default";
          bold = underline = false;
        }
        if (n === 1) bold = true;
        if (n === 22) bold = false;
        if (n === 4) underline = true;
        if (n === 24) underline = false;
        if (n === 7) inverse = true;
        if (n === 27) inverse = false;
        if (n === 39) foreground = "default";
        if (n >= 30 && n <= 37) foreground = String(n);
        if (n === 49) background = "default";
        if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107))
          background = String(n);
        if (n === 38 || n === 48 || n === 58) {
          let payload = params[i].split(":").slice(1);
          if (!params[i].includes(":")) {
            const count = params[i + 1] === "5" ? 2 : 4;
            payload = params.slice(i + 1, i + 1 + count);
            i += count;
          }
          const color =
            payload[0] === "5"
              ? `palette:${payload.at(-1)}`
              : `rgb:${payload.slice(-3).join(",")}`;
          if (n === 38) foreground = color;
          if (n === 48) background = color;
        }
      }
    } else if (code.startsWith("\x1b]8;")) {
      link = code
        .slice(4, code.endsWith("\x07") ? -1 : -2)
        .split(";")
        .slice(1)
        .join(";");
    }
    position = match.index + code.length;
  }
  emit(text.slice(position));
  return result;

  function emit(run: string) {
    for (const { segment } of segmenter.segment(run)) {
      for (let i = 0; i < visibleWidth(segment); i++) {
        result.push({
          text: segment,
          inverse,
          foreground,
          background,
          bold,
          underline,
          link,
        });
      }
    }
  }
}

function expectSelection(row: string, selected: number[]): void {
  assert.deepEqual(
    cells(row)
      .map((cell, i) => (cell.inverse ? i : -1))
      .filter((i) => i !== -1),
    selected,
  );
}

type Internals = {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  visualAnchor: unknown;
  unnamedRegister: string;
  pastes: Map<number, string>;
  pasteCounter: number;
  undoStack: unknown;
  redoStack: unknown;
  lastRepeatableCommand: unknown;
  prefixCount: string;
  operatorCount: string;
  scrollOffset: number;
  layoutText(
    width: number,
  ): Array<{ text: string; hasCursor: boolean; cursorPos?: number }>;
  segment(
    text: string,
    mode: string,
  ): Iterable<{ segment: string; index: number }>;
  autocompleteState: unknown;
  autocompleteList: unknown;
};
const internal = (editor: ModalEditor) => editor as unknown as Internals;

function editingState(editor: ModalEditor): unknown {
  const host = internal(editor);
  return structuredClone({
    state: host.state,
    anchor: host.visualAnchor,
    mode: editor.getMode(),
    register: host.unnamedRegister,
    pastes: host.pastes,
    counter: host.pasteCounter,
    undo: host.undoStack,
    redo: host.redoStack,
    repeat: host.lastRepeatableCommand,
    prefix: host.prefixCount,
    operator: host.operatorCount,
  });
}

function renderChecked(editor: ModalEditor, width: number): string[] {
  const before = editingState(editor);
  const baseline = CustomEditor.prototype.render.call(editor, width);
  const result = editor.render(width);
  assert.deepEqual(
    editingState(editor),
    before,
    "render must not edit selection or buffer/history/register/paste state",
  );
  assert.deepEqual(
    result.slice(0, -1).map(plain),
    baseline.slice(0, -1).map(plain),
  );
  for (const row of result)
    assert.ok(
      visibleWidth(row) <= width,
      `row exceeds width ${width}: ${JSON.stringify(row)}`,
    );
  return result;
}

describe("Visual selection rendering", () => {
  it("highlights inclusive forward/reverse endpoints, not repeated matching text", () => {
    const { editor } = createMultiLineEditor("abc abc abc");
    setInternalCursor(editor, 5);
    sendKeys(editor, ["v", "l"]);
    let output = renderChecked(editor, 24);
    expectSelection(output[1], [5, 6]);
    sendKeys(editor, ["o"]);
    output = renderChecked(editor, 24);
    expectSelection(output[1], [5, 6]);
    sendKeys(editor, ["h", "h"]);
    output = renderChecked(editor, 24);
    expectSelection(output[1], [3, 4, 5, 6]);
  });

  it("marks charwise multi-line suffix, newline, empty line, and prefix", () => {
    const { editor } = createMultiLineEditor("abcd\n\nwxyz");
    setInternalCursor(editor, 2);
    editor.handleInput("v");
    setInternalCursor(editor, 1, 2);
    const output = renderChecked(editor, 12);
    expectSelection(output[1], [2, 3, 4]);
    expectSelection(output[2], [0]);
    expectSelection(output[3], [0, 1]);
    assert.ok(output.at(-1)?.includes("VISUAL"));
    expectSelection(output[0], []);
    expectSelection(output.at(-1) ?? "", []);
  });

  it("shows a singleton selection on an empty editor and at EOL", () => {
    for (const text of ["", "abc"]) {
      const { editor } = createMultiLineEditor(text);
      setInternalCursor(editor, text.length);
      editor.handleInput("v");
      const output = renderChecked(editor, 10);
      expectSelection(output[1], [text.length]);
    }
  });

  it("V selects whole content rows including blanks but excludes horizontal padding", () => {
    const { editor } = createMultiLineEditor("abcd\n\nwxyz\nlast");
    editor.setPaddingX(2);
    setInternalCursor(editor, 3, 2);
    editor.handleInput("V");
    setInternalCursor(editor, 2, 0);
    const output = renderChecked(editor, 14);
    for (const row of output.slice(1, 4))
      expectSelection(row, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expectSelection(output[4], []);
  });

  it("uses host word wrapping and updates correctly on resize", () => {
    const { editor } = createMultiLineEditor("one two three four five");
    setInternalCursor(editor, 4);
    editor.handleInput("v");
    setInternalCursor(editor, 14);
    const narrow = renderChecked(editor, 9);
    assert.equal(plain(narrow[1]), "one two  ");
    expectSelection(narrow[1], [4, 5, 6, 7]);
    assert.equal(plain(narrow[2]), "three    ");
    expectSelection(narrow[2], [0, 1, 2, 3, 4, 5]);
    expectSelection(narrow[3], [0]);
    const wide = renderChecked(editor, 40);
    expectSelection(
      wide[1],
      Array.from({ length: 11 }, (_, i) => i + 4),
    );
  });

  it("clips highlighting to the host's scrolled viewport, in both directions", () => {
    const tui = createCursorShapeTui();
    tui.terminal.rows = 10;
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    editor.setText(Array.from({ length: 12 }, (_, i) => `row${i}`).join("\n"));
    editor.handleInput("\x1b");
    setInternalCursor(editor, 1, 0);
    editor.handleInput("V");
    setInternalCursor(editor, 1, 10);
    let output = renderChecked(editor, 22);
    assert.equal(internal(editor).scrollOffset, 6);
    assert.equal(plain(output[1]).trim(), "row6");
    assert.ok(plain(output[0]).includes("↑"));
    for (const row of output.slice(1, 6))
      expectSelection(
        row,
        Array.from({ length: 22 }, (_, i) => i),
      );
    sendKeys(editor, ["o"]);
    output = renderChecked(editor, 22);
    assert.equal(internal(editor).scrollOffset, 0);
    assert.equal(plain(output[1]).trim(), "row0");
    for (const row of output.slice(1, 6))
      expectSelection(
        row,
        Array.from({ length: 22 }, (_, i) => i),
      );
  });

  it("highlights complete combining, wide, and ZWJ graphemes", () => {
    const { editor } = createMultiLineEditor("a e\u0301界👩‍💻z");
    setInternalCursor(editor, 2);
    editor.handleInput("v");
    setInternalCursor(editor, 5);
    const output = renderChecked(editor, 18);
    expectSelection(output[1], [2, 3, 4, 5, 6]);
    const selected = cells(output[1])
      .filter((c) => c.inverse)
      .map((c) => c.text);
    assert.deepEqual(selected, ["e\u0301", "界", "界", "👩‍💻", "👩‍💻"]);
  });

  it("highlights Unicode selections through narrow wrapped rows without splitting cells", () => {
    const { editor } = createMultiLineEditor("界界界界👩‍💻e\u0301z");
    editor.handleInput("v");
    setInternalCursor(editor, 4);
    const output = renderChecked(editor, 7);
    const selected = output.slice(1, -1).flatMap((row) =>
      cells(row)
        .filter((c) => c.inverse)
        .map((c) => c.text),
    );
    assert.deepEqual(selected, Array(8).fill("界").concat(["👩‍💻", "👩‍💻"]));
  });

  it("highlights exactly the copied paste-marker range, even when visually split", () => {
    const tui = createCursorShapeTui();
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    const marker = "[paste #1 1234 chars]";
    editor.setClipboardMirrorPolicy("never");
    editor.setClipboardFn(() => {});
    editor.setClipboardReadFn(() => null);
    editor.setText(`a${marker}z`);
    internal(editor).pastes.set(1, "p".repeat(1234));
    internal(editor).pasteCounter = 1;
    editor.handleInput("\x1b");
    editor.focused = true;
    setInternalCursor(editor, 1);
    for (const wholeMarker of [false, true]) {
      editor.handleInput("v");
      if (wholeMarker) setInternalCursor(editor, marker.length);
      const expected = wholeMarker ? marker : "[";
      for (const width of [35, 9]) {
        const output = renderChecked(editor, width);
        const selected = output
          .slice(1, -1)
          .flatMap((row) =>
            cells(row)
              .filter((c) => c.inverse)
              .map((c) => c.text),
          )
          .join("");
        assert.equal(selected, expected);
      }
      editor.handleInput("y");
      assert.equal(editor.getRegister(), expected);
      assert.equal(editor.getExpandedText(), `a${"p".repeat(1234)}z`);
    }
  });

  it("does not treat an unregistered literal paste marker as atomic", () => {
    const { editor } = createMultiLineEditor("a[paste #9 1234 chars]z");
    setInternalCursor(editor, 1);
    editor.handleInput("v");
    expectSelection(renderChecked(editor, 35)[1], [1]);
  });

  it("preserves cursor marker and highlights the cursor after hardware synchronization", () => {
    const tui = createCursorShapeTui();
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    editor.setText("abcdef");
    editor.handleInput("\x1b");
    setInternalCursor(editor, 1);
    editor.focused = true;
    sendKeys(editor, ["v", "l", "l"]);
    const output = renderChecked(editor, 18);
    expectSelection(output[1], [1, 2, 3]);
    assert.equal(output.join("").split(CURSOR_MARKER).length - 1, 1);
    assert.equal(
      visibleWidth(output[1].slice(0, output[1].indexOf(CURSOR_MARKER))),
      3,
    );
    assert.ok(tui.terminalWrites.includes("\x1b[1 q"));
  });

  it("keeps EOL cursor highlight when it overflows into padding", () => {
    const { editor } = createMultiLineEditor("abcdef");
    editor.setPaddingX(1);
    setInternalCursor(editor, 6);
    editor.handleInput("V");
    const output = renderChecked(editor, 8);
    expectSelection(output[1], [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(visibleWidth(output[1]), 8);
  });

  it("does not style autocomplete or borders", () => {
    const { editor } = createMultiLineEditor("abc");
    sendKeys(editor, ["v", "l"]);
    internal(editor).autocompleteState = {};
    internal(editor).autocompleteList = { render: () => ["MENU", "abc"] };
    const output = renderChecked(editor, 18);
    expectSelection(output[1], [0, 1]);
    expectSelection(output[0], []);
    expectSelection(output[2], []);
    expectSelection(output[3], []);
    expectSelection(output[4], []);
    assert.equal(plain(output[3]).trim(), "MENU");
  });

  it("clears selection on Escape and toggles v/V without stale styling", () => {
    const { editor } = createMultiLineEditor("abcdef");
    sendKeys(editor, ["v", "l", "l"]);
    expectSelection(renderChecked(editor, 18)[1], [0, 1, 2]);
    editor.handleInput("V");
    expectSelection(
      renderChecked(editor, 18)[1],
      Array.from({ length: 18 }, (_, i) => i),
    );
    editor.handleInput("v");
    expectSelection(renderChecked(editor, 18)[1], [0, 1, 2]);
    editor.handleInput("\x1b");
    expectSelection(renderChecked(editor, 18)[1], [2]); // host software cursor only
    editor.handleInput("i");
    expectSelection(renderChecked(editor, 18)[1], [2]);
  });

  it("does exactly one host layout pass in every mode, and restores the method", () => {
    const { editor } = createMultiLineEditor("abc def ghi");
    const host = internal(editor);
    const original = host.layoutText;
    let calls = 0;
    const spy: typeof original = (width) => {
      calls++;
      return original.call(host, width);
    };
    host.layoutText = spy;
    for (const keys of [[], ["v"], ["V"], ["\x1b"], ["i"]]) {
      sendKeys(editor, keys);
      const previous = calls;
      editor.render(9);
      assert.equal(calls - previous, 1);
      assert.equal(host.layoutText, spy);
    }
  });

  it("fails clearly for unsupported private layout instead of invisible selection", () => {
    for (const failure of [
      "rows",
      "cursor",
      "segment",
      "missing",
      "empty",
      "frozen",
    ]) {
      const { editor } = createMultiLineEditor("abcdef");
      editor.handleInput("v");
      const host = internal(editor);
      const original = host.layoutText;
      if (failure === "segment")
        host.segment = null as unknown as typeof host.segment;
      else if (failure === "missing")
        host.layoutText = null as unknown as typeof host.layoutText;
      else if (failure === "frozen")
        Object.defineProperty(host, "layoutText", {
          value: original,
          writable: false,
        });
      else
        host.layoutText = (width) => {
          if (failure === "empty") return [];
          const rows = original.call(host, width);
          if (failure === "rows") rows[0].text = "bad";
          else rows[0].cursorPos = 2;
          return rows;
        };
      const installed = host.layoutText;
      assert.throws(
        () => editor.render(18),
        /Visual selection: unsupported Pi editor layout/,
      );
      assert.equal(host.layoutText, installed);
      assert.equal(editor.getText(), "abcdef");
      editor.handleInput("\x1b");
    }
  });

  it("restores the intercepted layout method when host rendering throws", () => {
    const { editor } = createMultiLineEditor("abc");
    editor.handleInput("v");
    const host = internal(editor);
    const method = host.layoutText;
    editor.borderColor = () => {
      throw new Error("border failure");
    };
    assert.throws(() => editor.render(18), /border failure/);
    assert.equal(host.layoutText, method);
    assert.equal(Object.hasOwn(host, "layoutText"), false);
  });

  for (const modeKey of ["v", "V"]) {
    for (const operator of ["y", "d", "c"]) {
      it(`rendering leaves ${modeKey}${operator} semantics and clipboard writes unchanged`, () => {
        const rendered = createMultiLineEditor("one two\nthree four");
        const control = createMultiLineEditor("one two\nthree four");
        for (const key of [modeKey, "e", "j", operator]) {
          rendered.editor.handleInput(key);
          control.editor.handleInput(key);
          renderChecked(rendered.editor, 9);
        }
        assert.deepEqual(
          editingState(rendered.editor),
          editingState(control.editor),
        );
        assert.deepEqual(rendered.clipboardWrites, control.clipboardWrites);
      });
    }
  }
});

describe("ANSI selection composition", () => {
  it("preserves foreground, resets, links, and cursor marker while reapplying selection inverse", () => {
    const source = `\x1b[31ma\x1b]8;;https://example.org\x07b${CURSOR_MARKER}\x1b[7mc\x1b[0md\x1b]8;;\x1b\\e`;
    const painted = highlightCells(source, 1, 4);
    assert.equal(plain(painted), "abcde");
    assert.equal(visibleWidth(painted), visibleWidth(source));
    expectSelection(painted, [1, 2, 3]);
    assert.deepEqual(
      cells(painted).map((c) => c.foreground),
      ["31", "31", "31", "default", "default"],
    );
    assert.ok(painted.includes(CURSOR_MARKER));
    for (const sequence of source.matchAll(ansi))
      assert.ok(painted.includes(sequence[0]), `lost ${sequence[0]}`);
    assert.equal(cells(`${painted}Z`).at(-1)?.inverse, false);
  });

  it("ends selection inverse across foreground, bold, and extended-color boundaries", () => {
    for (const style of [
      "\x1b[31m",
      "\x1b[1m",
      "\x1b[38;5;7m",
      "\x1b[48;2;7;0;27m",
      "\x1b[38:2::7:0:27m",
    ]) {
      const source = `a${style}b${style}c`;
      for (const [from, to, expected] of [
        [0, 1, [0]],
        [1, 2, [1]],
        [0, 2, [0, 1]],
      ] as const) {
        const painted = highlightCells(source, from, to);
        expectSelection(painted, [...expected]);
        assert.equal(plain(painted), "abc");
        assert.equal(cells(`${painted}Z`).at(-1)?.inverse, false);
      }
    }
  });

  it("restores a host inverse style outside the selection and ignores color payloads", () => {
    const source = "\x1b[7mab\x1b[27m\x1b[38;5;7mc\x1b[48;2;7;0;27md\x1b[0me";
    const painted = highlightCells(source, 2, 4);
    expectSelection(painted, [0, 1, 2, 3]);
    assert.equal(plain(painted), "abcde");
    assert.equal(cells(`${painted}Z`).at(-1)?.inverse, false);
  });

  it("paints selectedBg without changing foreground, formatting, links or cursor markers", () => {
    const source = `\x1b[44;1;4;38;2;7;0;27ma\x1b]8;;https://example.org\x07b${CURSOR_MARKER}\x1b[48;5;7mc\x1b[0md\x1b]8;;\x1b\\\x1b[48:2::27:7:0me`;
    const painted = highlightCells(source, 1, 4, "\x1b[48;2;0;7;27m");
    assert.equal(plain(painted), plain(source));
    assert.equal(visibleWidth(painted), visibleWidth(source));
    assert.deepEqual(
      cells(painted).map((c) => c.background),
      ["44", "rgb:0,7,27", "rgb:0,7,27", "rgb:0,7,27", "rgb:27,7,0"],
    );
    assert.deepEqual(
      cells(painted).map((c) => ({ ...c, background: undefined })),
      cells(source).map((c) => ({ ...c, background: undefined })),
    );
    assert.deepEqual(
      cells(painted).map((c) => c.link),
      [
        "",
        "https://example.org",
        "https://example.org",
        "https://example.org",
        "",
      ],
    );
    assert.ok(painted.includes(CURSOR_MARKER));
    for (const sequence of source.matchAll(ansi))
      assert.ok(painted.includes(sequence[0]), `lost ${sequence[0]}`);
    assert.equal(cells(`${painted}Z`).at(-1)?.background, "rgb:27,7,0");
  });

  it("reapplies selection after host background/reset commands and restores the latest host background", () => {
    for (const style of [
      "\x1b[0m",
      "\x1b[m",
      "\x1b[49m",
      "\x1b[41m",
      "\x1b[104m",
      "\x1b[48;5;0m",
      "\x1b[48;5;7m",
      "\x1b[48;5;27m",
      "\x1b[48;2;7;0;27m",
      "\x1b[48:2::0:7:27m",
      "\x1b[48:2:0:27:7:0m",
      "\x1b[48:5:7m",
      "\x1b[0;44;1m",
      "\x1b[48;2;7;0;27;0m",
      "\x1b[38;5;7m",
      "\x1b[38:2::7:0:27;1m",
      "\x1b[58;2;7;0;27m",
    ]) {
      const source = `\x1b[44ma${style}b${style}c`;
      for (const [from, to] of [
        [0, 1],
        [1, 2],
        [0, 2],
        [1, 3],
      ]) {
        const painted = highlightCells(source, from, to, "\x1b[48;5;25m");
        assert.deepEqual(
          cells(painted).map((c) => c.background),
          cells(source).map((c, i) =>
            i >= from && i < to ? "palette:25" : c.background,
          ),
          `${JSON.stringify(style)}, ${from}:${to}`,
        );
        assert.deepEqual(
          cells(painted).map((c) => ({ ...c, background: undefined })),
          cells(source).map((c) => ({ ...c, background: undefined })),
        );
        assert.deepEqual(
          cells(`${painted}Z`).at(-1),
          cells(`${source}Z`).at(-1),
        );
      }
    }
  });

  it("supports terminal-default selectedBg and preserves host inverse attributes", () => {
    const source = "\x1b[44;7mab\x1b[27mc";
    const painted = highlightCells(source, 1, 2, "\x1b[49m");
    assert.deepEqual(
      cells(painted).map((c) => c.background),
      ["44", "default", "44"],
    );
    assert.deepEqual(
      cells(painted).map((c) => c.inverse),
      [true, true, false],
    );
    assert.equal(cells(`${painted}Z`).at(-1)?.background, "44");
  });
});

function selectionTheme(color: string | number): Theme {
  type Args = ConstructorParameters<typeof Theme>;
  return new Theme(
    { muted: "", text: "", thinkingXhigh: "" } as Args[0],
    { selectedBg: color } as Args[1],
    "truecolor",
  );
}

function expectBackground(
  row: string,
  selected: number[],
  background: string,
): void {
  assert.deepEqual(
    cells(row).map((c) => c.background),
    cells(row).map((_, i) => (selected.includes(i) ? background : "default")),
  );
}

// Pi's selectedBg is a UI paint policy, not a change to Vim range semantics.
// Existing geometry and nvim parity coverage continue to exercise those ranges.
describe("Theme-native Visual selection", () => {
  it("uses the injected theme background for charwise, empty and V-LINE rows, never padding/borders", () => {
    const theme = selectionTheme(27);
    const editor = new ModalEditor(
      createCursorShapeTui(),
      stubTheme,
      stubKeybindings,
      {
        selectionBackground: (s) => theme.bg("selectedBg", s),
      },
    );
    editor.setText("a界z\n\nlast");
    editor.setPaddingX(1);
    editor.focused = true;
    editor.handleInput("\x1b");
    setInternalCursor(editor, 1);
    editor.handleInput("v");
    setInternalCursor(editor, 0, 1);
    let output = renderChecked(editor, 12);
    expectBackground(output[1], [2, 3, 4, 5], "palette:27");
    expectBackground(output[2], [1], "palette:27");
    assert.equal(output.join("").split(CURSOR_MARKER).length - 1, 1);
    editor.handleInput("V");
    output = renderChecked(editor, 12);
    for (const row of output.slice(1, 3))
      expectBackground(
        row,
        Array.from({ length: 10 }, (_, i) => i + 1),
        "palette:27",
      );
    for (const row of [output[0], ...output.slice(3)])
      expectBackground(row, [], "palette:27");
    editor.handleInput("\x1b");
    output = renderChecked(editor, 12);
    for (const row of output) expectBackground(row, [], "palette:27");
  });

  it("looks up the current ctx.ui.theme on every render, including hot reload and no-bg fallback", async () => {
    const restore = setPiVimSettingsReaderForTests(() => ({}));
    const pi = createExtensionApiHarness();
    type Factory = (
      tui: ConstructorParameters<typeof ModalEditor>[0],
      theme: ConstructorParameters<typeof ModalEditor>[1],
      kb: ConstructorParameters<typeof ModalEditor>[2],
    ) => ModalEditor;
    let factory: Factory | undefined;
    let activeTheme: Theme | typeof stubTheme = stubTheme;
    let reads = 0;
    const ctx = {
      cwd: process.cwd(),
      hasUI: true,
      ui: {
        get theme() {
          reads++;
          return activeTheme;
        },
        setEditorComponent(value: Factory) {
          factory = value;
        },
        notify() {},
      },
      shutdown() {},
    };
    try {
      installPiVim(pi);
      await pi.emit("session_start", undefined, ctx);
      assert.ok(factory);
      const editor = factory(
        createCursorShapeTui(),
        stubTheme,
        stubKeybindings,
      );
      editor.setText("abcde");
      editor.focused = true;
      editor.handleInput("\x1b");
      setInternalCursor(editor, 1);
      sendKeys(editor, ["v", "l"]);
      expectSelection(renderChecked(editor, 12)[1], [1, 2]);
      for (const [theme, background] of [
        [selectionTheme(7), "palette:7"],
        [selectionTheme("#00071b"), "rgb:0,7,27"],
        [selectionTheme(0), "palette:0"],
      ] as const) {
        activeTheme = theme; // Pi replaces the Theme instance on switch/reload.
        const previousReads = reads;
        const output = renderChecked(editor, 12);
        assert.ok(
          reads > previousReads,
          "render must read the active theme getter",
        );
        expectBackground(output[1], [1, 2], background);
        assert.equal(
          cells(output[1]).some((c) => c.inverse),
          false,
        );
        assert.equal(cells(`${output[1]}Z`).at(-1)?.background, "default");
      }
      activeTheme = stubTheme;
      expectSelection(renderChecked(editor, 12)[1], [1, 2]);
      activeTheme = selectionTheme(27);
      editor.handleInput("\x1b");
      for (const row of renderChecked(editor, 12))
        expectBackground(row, [], "palette:27");
      editor.handleInput("i");
      for (const row of renderChecked(editor, 12))
        expectBackground(row, [], "palette:27");
    } finally {
      restore();
      await pi.emit("session_shutdown", { reason: "test" }, ctx);
    }
  });
});
