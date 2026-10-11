import { visibleWidth } from "@earendil-works/pi-tui";
import {
  getInclusiveEndColumn,
  orderVisualEndpoints,
  type VisualMode,
  type VisualPosition,
} from "./visual.js";

export type SelectionBackground = (text: string) => string | undefined;

type LayoutRow = { text: string; hasCursor: boolean; cursorPos?: number };
type Segment = { segment: string; index: number };
type Host = {
  layoutText(width: number): LayoutRow[];
  segment(text: string, mode: "grapheme"): Iterable<Segment>;
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  paddingX: number;
  scrollOffset: number;
  lastWidth: number;
  tui: { terminal: { rows: number } };
};
type SourceRow = LayoutRow & { line: number; start: number; end: number };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/* eslint-disable no-control-regex -- Terminal styling and cursor markers use ESC/BEL. */
const terminalSequence =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal sequences use ESC/BEL.
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]_]([^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g;
/* eslint-enable no-control-regex */

function stripTerminalSequences(text: string): string {
  const stripped = text.replace(terminalSequence, "");
  if (stripped.includes("\x1b")) unsupported("unrecognized terminal sequence");
  return stripped;
}

function unsupported(detail: string): never {
  throw new Error(`Visual selection: unsupported Pi editor layout (${detail})`);
}

/**
 * Narrow private-API adapter for Pi 0.78.0 / 0.87.1. Capture the actual host
 * layout, not a second layout pass. These hosts partition each logical line
 * into contiguous, lossless UTF-16 substrings, in buffer order. Validate that
 * contract before using cumulative offsets; never search for selected text.
 * The callback must also perform software/hardware cursor synchronization.
 */
export function renderVisualSelection(
  editor: unknown,
  width: number,
  mode: VisualMode,
  anchor: VisualPosition,
  cursor: VisualPosition,
  renderHost: () => string[],
  paintBackground?: SelectionBackground | null,
): string[] {
  const host = editor as Host;
  if (
    typeof host.layoutText !== "function" ||
    typeof host.segment !== "function" ||
    !Array.isArray(host.state?.lines) ||
    !Number.isInteger(host.paddingX) ||
    host.paddingX < 0 ||
    !Number.isFinite(host.tui?.terminal?.rows) ||
    !Number.isInteger(width) ||
    width < 1
  ) {
    unsupported("missing layout/segmentation/geometry");
  }
  const padding = Math.min(
    host.paddingX,
    Math.max(0, Math.floor((width - 1) / 2)),
  );
  const contentWidth = Math.max(1, width - padding * 2);
  const layoutWidth = Math.max(1, contentWidth - (padding ? 0 : 1));
  const original = host.layoutText;
  const ownDescriptor = Object.getOwnPropertyDescriptor(host, "layoutText");
  let captured: LayoutRow[] | undefined;
  try {
    host.layoutText = function (available: number): LayoutRow[] {
      if (captured || available !== layoutWidth)
        unsupported("layout invocation");
      captured = original.call(this, available);
      if (!Array.isArray(captured) || !captured.length)
        unsupported("no captured rows");
      return captured;
    };
  } catch {
    unsupported("layout method cannot be intercepted");
  }
  let rendered: string[];
  try {
    rendered = renderHost();
  } finally {
    if (ownDescriptor) Object.defineProperty(host, "layoutText", ownDescriptor);
    else Reflect.deleteProperty(host, "layoutText");
  }
  if (!Array.isArray(captured) || !captured.length)
    unsupported("no captured rows");
  if (
    host.lastWidth !== layoutWidth ||
    !Number.isInteger(host.scrollOffset) ||
    host.scrollOffset < 0 ||
    host.scrollOffset >= captured.length
  ) {
    unsupported("scroll geometry");
  }
  const rows = mapSourceRows(captured, host);
  const visible = rows.slice(
    host.scrollOffset,
    host.scrollOffset + Math.max(5, Math.floor(host.tui.terminal.rows * 0.3)),
  );
  if (rendered.length < visible.length + 2) unsupported("content row count");
  // Pi's bg helper wraps text with a background SGR and a trailing SGR 49.
  // Resolve the wrapper once per frame, never retain a theme-colored string.
  const background = paintBackground?.("\0")?.split("\0")[0];
  const { start, end } = orderVisualEndpoints(anchor, cursor);
  const spans = new Map<number, { start: number; end: number }>();
  for (let i = 0; i < visible.length; i++) {
    const row = visible[i];
    const output = rendered[i + 1];
    // Host cursor at EOL adds one cell, even after its software style is removed.
    const cursorSpace = row.hasCursor && row.cursorPos === row.text.length;
    const textWidth = visibleWidth(row.text) + (cursorSpace ? 1 : 0);
    const expected =
      " ".repeat(padding) +
      stripTerminalSequences(row.text) +
      (cursorSpace ? " " : "") +
      " ".repeat(Math.max(0, contentWidth - textWidth)) +
      " ".repeat(Math.max(0, padding - (textWidth > contentWidth ? 1 : 0)));
    if (stripTerminalSequences(output) !== expected)
      unsupported("rendered content mapping");
    if (row.line < start.line || row.line > end.line) continue;
    let from = padding;
    let to = padding + Math.max(contentWidth, textWidth);
    if (mode === "visual") {
      const source = host.state.lines[row.line];
      let span = spans.get(row.line);
      if (!span) {
        // Share Vim's range geometry with y/d/c: Pi's host segmenter also
        // groups paste markers, but Vim's charwise operators do not. Painting
        // that larger atomic span would promise more than the operator copies.
        span = {
          start: row.line === start.line ? start.col : 0,
          end:
            row.line === end.line
              ? getInclusiveEndColumn(source, end.col)
              : source.length,
        };
        spans.set(row.line, span);
      }
      const a = Math.max(row.start, span.start);
      const b = Math.min(row.end, span.end);
      from =
        padding + visibleWidth(source.slice(row.start, Math.min(a, row.end)));
      to =
        padding + visibleWidth(source.slice(row.start, Math.max(row.start, b)));
      // Represent a selected newline/EOL/empty line with one existing blank
      // cell, only on the final wrapped row. Do not add or change content.
      if (
        row.end === source.length &&
        span.end === source.length &&
        (row.line < end.line || end.col >= source.length)
      ) {
        to = Math.min(padding + Math.max(contentWidth, textWidth), to + 1);
      }
    }
    if (to > from)
      rendered[i + 1] = highlightCells(output, from, to, background);
  }
  return rendered;
}

function mapSourceRows(layout: LayoutRow[], host: Host): SourceRow[] {
  const rows: SourceRow[] = [];
  let line = 0;
  let start = 0;
  let cursors = 0;
  for (const row of layout) {
    const source = host.state.lines[line];
    if (
      typeof row.text !== "string" ||
      typeof row.hasCursor !== "boolean" ||
      source === undefined ||
      source.slice(start, start + row.text.length) !== row.text ||
      (row.text.length === 0 && source.length !== 0)
    ) {
      unsupported("non-contiguous source rows");
    }
    const end = start + row.text.length;
    if (row.hasCursor) {
      cursors++;
      if (
        line !== host.state.cursorLine ||
        !Number.isInteger(row.cursorPos) ||
        row.cursorPos !== host.state.cursorCol - start ||
        (row.cursorPos ?? -1) < 0 ||
        (row.cursorPos ?? Infinity) > row.text.length
      ) {
        unsupported("cursor mapping");
      }
    }
    rows.push({ ...row, line, start, end });
    start = end;
    if (end === source.length) {
      line++;
      start = 0;
    }
  }
  if (line !== host.state.lines.length || start !== 0 || cursors !== 1) {
    unsupported("incomplete source rows");
  }
  return rows;
}

/** Paint a cell interval without losing host SGR/OSC/APC bytes. An optional
 * background-opening SGR replaces reverse video; all other attributes stay
 * intact. Host resets cannot clear selection, and its host style is restored
 * at the boundary, including when the host changes background inside selection.
 */
export function highlightCells(
  text: string,
  from: number,
  to: number,
  background?: string,
): string {
  let result = "";
  let column = 0;
  let hostInverse = false;
  let inverse = false;
  let hostBackground = "\x1b[49m";
  let activeBackground = hostBackground;
  const setBackground = (value: string) => {
    if (activeBackground !== value) {
      result += value;
      activeBackground = value;
    }
  };
  const setInverse = (value: boolean) => {
    if (inverse !== value) {
      result += value ? "\x1b[7m" : "\x1b[27m";
      inverse = value;
    }
  };
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\x1b") {
      terminalSequence.lastIndex = i;
      const match = terminalSequence.exec(text);
      if (!match || match.index !== i)
        unsupported("unrecognized terminal sequence");
      const code = match[0];
      result += code;
      if (code.startsWith("\x1b[") && code.endsWith("m")) {
        const params = code.slice(2, -1).split(";");
        for (let p = 0; p < params.length; p++) {
          const start = p;
          const n = Number(params[p].split(":")[0]);
          // Extended colors are one SGR command, not a sequence of attributes:
          // RGB components and palette indexes may themselves be 0, 7 or 27.
          if ((n === 38 || n === 48 || n === 58) && !params[p].includes(":")) {
            p += params[p + 1] === "5" ? 2 : params[p + 1] === "2" ? 4 : 0;
          }
          if (n === 0 || n === 27) {
            hostInverse = false;
            inverse = false;
          } else if (n === 7) {
            hostInverse = true;
            inverse = true;
          }
          if (n === 0 || n === 49) {
            hostBackground = activeBackground = "\x1b[49m";
          } else if (
            n === 48 ||
            (n >= 40 && n <= 47) ||
            (n >= 100 && n <= 107)
          ) {
            hostBackground =
              activeBackground = `\x1b[${params.slice(start, p + 1).join(";")}m`;
          }
        }
      }
      i += code.length;
      continue;
    }
    const nextEscape = text.indexOf("\x1b", i);
    const limit = nextEscape === -1 ? text.length : nextEscape;
    for (const { segment } of segmenter.segment(text.slice(i, limit))) {
      const cells = visibleWidth(segment);
      const selected = column < to && column + cells > from;
      if (background !== undefined)
        setBackground(selected ? background : hostBackground);
      else setInverse(selected || hostInverse);
      result += segment;
      column += cells;
    }
    i = limit;
  }
  // Restore the host's final state; do not leak selection into borders.
  if (background !== undefined) setBackground(hostBackground);
  else setInverse(hostInverse);
  return result;
}
