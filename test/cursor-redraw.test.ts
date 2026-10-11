import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as piTui from "@earendil-works/pi-tui";
import { enableCursorShapeSupport } from "../cursor-shape.js";
import installPiVim, { type ModalEditor } from "../index.js";
import {
  createCursorShapeTui,
  createExtensionApiHarness,
  stubKeybindings,
  stubTheme,
} from "./harness.js";

const BEGIN = "\x1b[?2026h";
const END = "\x1b[?2026l";
const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const ESC = String.fromCharCode(27);
const TERMINAL_TOKENS = new RegExp(
  `${ESC}\\[[?0-9; ]*[A-Za-z]|[\\r\\n]|[^${ESC}]`,
  "g",
);

function createTerminal() {
  return {
    columns: 80,
    rows: 24,
    visible: false,
    row: 0,
    col: 0,
    writes: [] as string[],
    frames: [] as Array<{ visible: boolean; row: number; col: number }>,
    write(data: string) {
      this.writes.push(data);
      for (const token of data.match(TERMINAL_TOKENS) ?? []) {
        if (token === HIDE) this.visible = false;
        else if (token === SHOW) this.visible = true;
        else if (token === END)
          this.frames.push({
            visible: this.visible,
            row: this.row,
            col: this.col,
          });
        else if (token === "\r") this.col = 0;
        else if (token === "\n") this.row++;
        else if (
          token.startsWith(`${ESC}[`) &&
          /^\d+[ABG]$/.test(token.slice(2))
        ) {
          const amount = Number(token.slice(2, -1));
          if (token.endsWith("A")) this.row -= amount;
          else if (token.endsWith("B")) this.row += amount;
          else this.col = amount - 1;
        } else if (!token.startsWith("\x1b")) this.col++;
      }
    },
    hideCursor() {
      this.write(HIDE);
    },
    showCursor() {
      this.write(SHOW);
    },
  };
}

describe("hardware cursor during redraw", () => {
  it("hides the cursor before publishing an update and leaves host positioning intact", () => {
    const terminal = createTerminal();
    const tui = { terminal, setShowHardwareCursor() {} };
    const cleanup = enableCursorShapeSupport(tui);
    assert.ok(cleanup);
    terminal.visible = true;
    terminal.write(`${BEGIN}\rstatus updating${END}`);
    assert.deepEqual(terminal.frames, [{ visible: false, row: 0, col: 15 }]);
    terminal.write("\x1b[2B\x1b[4G");
    terminal.showCursor();
    assert.deepEqual(
      [terminal.visible, terminal.row, terminal.col],
      [true, 2, 3],
    );
    cleanup();
  });

  it("fixes real Pi main-screen full, idle, status-only, editor and marker-free renders", () => {
    type Host = {
      addChild(child: { render(width: number): string[] }): void;
      doRender(): void;
    };
    const exports = piTui as unknown as {
      TuiMainScreen?: new (terminal: unknown, show: boolean) => Host;
      TUI?: new (terminal: unknown, show: boolean) => Host;
    };
    const MainScreen = exports.TuiMainScreen ?? exports.TUI;
    assert.ok(MainScreen, "supported Pi must export its main-screen renderer");
    const terminal = createTerminal();
    const tui = new MainScreen(terminal, true);
    const cleanup = enableCursorShapeSupport(tui);
    assert.ok(cleanup);
    let status = "working";
    let text = "abc";
    let focused = true;
    tui.addChild({
      render: () => [
        status,
        `${text}${focused ? piTui.CURSOR_MARKER : ""}`,
        "footer",
      ],
    });
    const render = () => {
      terminal.frames.length = 0;
      tui.doRender();
      assert.equal(
        terminal.frames.every((frame) => !frame.visible),
        true,
      );
      assert.equal(terminal.visible, focused);
      if (focused)
        assert.deepEqual([terminal.row, terminal.col], [1, text.length]);
    };
    render(); // Full redraw.
    render(); // Unchanged frame still restores the cursor.
    for (const update of ["pondering", "pondering...", "weather updated"]) {
      status = update;
      render();
    }
    text += "d";
    render();
    focused = false;
    status = "no prompt cursor";
    render();
    cleanup();
  });

  it("preserves the fullscreen renderer's in-frame cursor positioning and visibility", () => {
    const terminal = createTerminal();
    const cleanup = enableCursorShapeSupport({
      terminal,
      setShowHardwareCursor() {},
    });
    assert.ok(cleanup);
    terminal.visible = true;
    // Unlike regular mode, fullscreen restores its cursor before ending sync.
    terminal.write(`${BEGIN}\rstatus updating\x1b[4G${SHOW}${END}`);
    assert.deepEqual(terminal.frames, [{ visible: true, row: 0, col: 3 }]);
    cleanup();
  });

  it("preserves ordinary writes and restores the original writer on cleanup", () => {
    const terminal = createTerminal();
    const original = terminal.write;
    const cleanup = enableCursorShapeSupport({
      terminal,
      setShowHardwareCursor() {},
    });
    assert.ok(cleanup);
    terminal.write("ordinary output");
    assert.equal(terminal.writes[0], "ordinary output");
    cleanup();
    assert.equal(terminal.write, original);
    terminal.write(`${BEGIN}after cleanup${END}`);
    assert.equal(terminal.writes.at(-1), `${BEGIN}after cleanup${END}`);
  });

  it("shares the guard across callers and tolerates repeated cleanup", () => {
    const terminal = createTerminal();
    const original = terminal.write;
    const tui = { terminal, setShowHardwareCursor() {} };
    const first = enableCursorShapeSupport(tui);
    const second = enableCursorShapeSupport(tui);
    assert.ok(first && second);
    terminal.write(`${BEGIN}frame${END}`);
    assert.equal(terminal.writes.at(-1), `${BEGIN}${HIDE}frame${END}`);
    first();
    first();
    terminal.write(`${BEGIN}second frame${END}`);
    assert.equal(terminal.writes.at(-1), `${BEGIN}${HIDE}second frame${END}`);
    second();
    assert.equal(terminal.write, original);
  });

  it("does not clobber later wrappers, and disables its retained guard", () => {
    const terminal = createTerminal();
    const cleanup = enableCursorShapeSupport({
      terminal,
      setShowHardwareCursor() {},
    });
    assert.ok(cleanup);
    const guarded = terminal.write;
    const later = function (this: typeof terminal, data: string) {
      guarded.call(this, data);
    };
    terminal.write = later;
    cleanup();
    assert.equal(terminal.write, later);
    terminal.write(`${BEGIN}after cleanup${END}`);
    assert.equal(terminal.writes.at(-1), `${BEGIN}after cleanup${END}`);
  });

  it("releases guards after immediate mount, factory recreation and shutdown", async () => {
    type Factory = (
      ...args: ConstructorParameters<typeof ModalEditor>
    ) => ModalEditor;
    for (const replaceTerminal of [false, true]) {
      const pi = createExtensionApiHarness();
      const first = createCursorShapeTui();
      const second = replaceTerminal ? createCursorShapeTui() : first;
      const firstWrite = first.terminal.write;
      const secondWrite = second.terminal.write;
      let factory: Factory | undefined;
      const ctx = {
        cwd: process.cwd(),
        hasUI: true,
        ui: {
          theme: stubTheme,
          setEditorComponent(value: Factory) {
            factory = value;
            value(first, stubTheme, stubKeybindings); // Pi mounts immediately.
          },
          notify() {},
        },
        shutdown() {},
      };
      installPiVim(pi);
      await pi.emit("session_start", undefined, ctx);
      assert.ok(factory);
      factory(second, stubTheme, stubKeybindings);
      if (replaceTerminal) {
        assert.equal(first.terminal.write, firstWrite);
        assert.equal(first.getShowHardwareCursor?.(), false);
      }
      second.terminal.write?.(`${BEGIN}mounted${END}`);
      assert.equal(
        second.terminalWrites.at(-1),
        `${BEGIN}${HIDE}mounted${END}`,
      );
      await pi.emit("session_shutdown", undefined, ctx);
      assert.equal(first.terminal.write, firstWrite);
      assert.equal(second.terminal.write, secondWrite);
      assert.equal(second.getShowHardwareCursor?.(), false);
      second.terminal.write?.(`${BEGIN}after shutdown${END}`);
      assert.equal(
        second.terminalWrites.at(-1),
        `${BEGIN}after shutdown${END}`,
      );
    }
  });

  it("leaves unsupported runtimes untouched", () => {
    const terminal = createTerminal();
    const original = terminal.write;
    assert.equal(enableCursorShapeSupport({ terminal }), null);
    assert.equal(terminal.write, original);
  });
});
