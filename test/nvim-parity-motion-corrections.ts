import { describe, it } from "node:test";
import { assertMatchesNvim, type NvimParityCase } from "./nvim-oracle.js";

const cases: NvimParityCase[] = [
  ...["w", "W"].flatMap((motion) => [
    {
      name: `c${motion} preserves the following gap`,
      initial: { text: "one  two", cursor: { line: 0, col: 0 } },
      keys: ["c", motion, "X", "\x1b"],
    },
    {
      name: `c${motion} at a word's final character changes only that character`,
      initial: { text: "one two", cursor: { line: 0, col: 2 } },
      keys: ["c", motion, "X", "\x1b"],
    },
    {
      name: `2c${motion} on single-character words`,
      initial: { text: "a b c", cursor: { line: 0, col: 0 } },
      keys: ["2", "c", motion, "X", "\x1b"],
    },
    {
      name: `2c${motion} crosses the first newline`,
      initial: { text: "one\ntwo three", cursor: { line: 0, col: 0 } },
      keys: ["2", "c", motion, "X", "\x1b"],
    },
    {
      name: `2c${motion} crosses a newline from a single-character word`,
      initial: { text: "a\nb", cursor: { line: 0, col: 0 } },
      keys: ["2", "c", motion, "X", "\x1b"],
    },
    {
      name: `c2${motion} crosses a newline from the current word end`,
      initial: { text: "one\ntwo", cursor: { line: 0, col: 2 } },
      keys: ["c", "2", motion, "X", "\x1b"],
    },
    {
      name: `3c${motion} clamps at EOF after counting the current word end`,
      initial: { text: "a b", cursor: { line: 0, col: 0 } },
      keys: ["3", "c", motion, "X", "\x1b"],
    },
    {
      name: `large c${motion} count clamps across lines and is consumed`,
      initial: { text: "one\ntwo", cursor: { line: 0, col: 2 } },
      keys: ["9", "9", "9", "9", "c", motion, "X", "\x1b", "0", "x"],
    },
    {
      name: `2c${motion} continues counting after the first current-end step`,
      initial: { text: "a\nb\nc", cursor: { line: 0, col: 0 } },
      keys: ["2", "c", motion, "X", "\x1b"],
    },
    {
      name: `c${motion} from whitespace keeps the terminal newline`,
      initial: { text: "one  \n  two three", cursor: { line: 0, col: 3 } },
      keys: ["c", motion, "X", "\x1b"],
    },
    {
      name: `d${motion} at the final buffer character clamps the cursor`,
      initial: { text: "one", cursor: { line: 0, col: 2 } },
      keys: ["d", motion],
    },
    {
      name: `d${motion} retains the terminal newline`,
      initial: { text: "one\ntwo three", cursor: { line: 0, col: 0 } },
      keys: ["d", motion],
    },
    {
      name: `d${motion} at EOL retains the newline and clamps the cursor`,
      initial: { text: "one\ntwo three", cursor: { line: 0, col: 2 } },
      keys: ["d", motion],
    },
    {
      name: `d${motion} consumes trailing spaces but not newline or next-line indent`,
      initial: { text: "one  \n  two three", cursor: { line: 0, col: 0 } },
      keys: ["d", motion],
    },
    {
      name: `2d${motion} trims only the terminal motion's newline`,
      initial: { text: "one two\nthree four", cursor: { line: 0, col: 0 } },
      keys: ["2", "d", motion],
    },
    {
      name: `2d${motion} counts an empty line as a word-motion stop`,
      initial: { text: "one\n\ntwo three", cursor: { line: 0, col: 0 } },
      keys: ["2", "d", motion],
    },
    {
      name: `2d${motion} can delete an intermediate newline`,
      initial: { text: "one\ntwo three", cursor: { line: 0, col: 0 } },
      keys: ["2", "d", motion],
    },
    {
      name: `2d${motion} spanning complete lines becomes linewise`,
      initial: { text: "a\nb\nc", cursor: { line: 0, col: 0 } },
      keys: ["2", "d", motion],
    },
    {
      name: `2d${motion} from the first nonblank includes indentation`,
      initial: { text: "  a\n  b\n  c", cursor: { line: 0, col: 2 } },
      keys: ["2", "d", motion],
    },
    {
      name: `2d${motion} after the first nonblank stays characterwise`,
      initial: { text: "prefix a\nb\nc", cursor: { line: 0, col: 7 } },
      keys: ["2", "d", motion],
    },
    {
      name: `2d${motion} whole-line register puts whole lines`,
      initial: { text: "a\nb\nc", cursor: { line: 0, col: 0 } },
      keys: ["2", "d", motion, "p"],
    },
    {
      name: `2d${motion} spanning complete lines at EOF becomes linewise`,
      initial: { text: "a\nb", cursor: { line: 0, col: 0 } },
      keys: ["2", "d", motion],
    },
    {
      name: `3d${motion} excludes an empty EOF endpoint from its register`,
      initial: { text: "a b\n", cursor: { line: 0, col: 0 } },
      keys: ["3", "d", motion],
    },
    {
      name: `d${motion} on an empty line retains the final empty line`,
      initial: { text: "a\n\n", cursor: { line: 1, col: 0 } },
      keys: ["d", motion],
    },
    {
      name: `2d${motion} excludes the final empty line`,
      initial: { text: "a\n\n", cursor: { line: 0, col: 0 } },
      keys: ["2", "d", motion],
    },
    {
      name: `large d${motion} count on empty lines excludes the EOF endpoint`,
      initial: { text: "\n\n", cursor: { line: 0, col: 0 } },
      keys: ["9", "d", motion],
    },
    {
      name: `d${motion} empty-line register puts exactly one line`,
      initial: { text: "a\n\n", cursor: { line: 1, col: 0 } },
      keys: ["d", motion, "p"],
    },
    {
      name: `y${motion} excludes the terminal newline too`,
      initial: { text: "one\ntwo three", cursor: { line: 0, col: 0 } },
      keys: ["y", motion],
    },
  ]),
  {
    name: "cw distinguishes punctuation from a keyword",
    initial: { text: "foo.bar baz", cursor: { line: 0, col: 3 } },
    keys: ["c", "w", "X", "\x1b"],
  },
  {
    name: "cw handles a non-BMP word without splitting it",
    initial: { text: "😀 word", cursor: { line: 0, col: 0 } },
    keys: ["c", "w", "X", "\x1b"],
  },
  {
    name: "$l stays on the final character",
    initial: { text: "one\ntwo", cursor: { line: 0, col: 0 } },
    keys: ["$", "l"],
  },
  {
    name: "h at BOL does not cross the newline",
    initial: { text: "one\ntwo", cursor: { line: 1, col: 0 } },
    keys: ["h"],
  },
  {
    name: "large l count stays on its logical line and does not leak",
    initial: { text: "abc\ndef", cursor: { line: 0, col: 0 } },
    keys: ["9", "9", "9", "l", "h"],
  },
  {
    name: "horizontal motions on an empty line",
    initial: { text: "one\n\ntwo", cursor: { line: 1, col: 0 } },
    keys: ["9", "l", "9", "h"],
  },
  {
    name: "horizontal movement respects a combining character",
    initial: { text: "áb", cursor: { line: 0, col: 0 } },
    keys: ["l", "h", "x"],
  },
  ...["d", "c", "y"].flatMap((op) => [
    {
      name: `${op}l at EOL uses the exclusive EOL boundary`,
      initial: { text: "abc\ndef", cursor: { line: 0, col: 2 } },
      keys: [op, "l", ...(op === "c" ? ["X", "\x1b"] : [])],
    },
    {
      name: `2${op}3l multiplies counts and clamps before newline`,
      initial: { text: "abcdefg\nnext", cursor: { line: 0, col: 2 } },
      keys: ["2", op, "3", "l", ...(op === "c" ? ["X", "\x1b"] : [])],
    },
    {
      name: `${op}9h clamps to BOL`,
      initial: { text: "abc\ndef", cursor: { line: 0, col: 2 } },
      keys: [op, "9", "h", ...(op === "c" ? ["X", "\x1b"] : [])],
    },
    {
      name: `${op}h at BOL applies the empty-range register rule`,
      initial: {
        text: "abc\ndef",
        cursor: { line: 0, col: 0 },
        register: "seed",
      },
      keys: [op, "h", ...(op === "c" ? ["X", "\x1b"] : [])],
    },
    {
      name: `${op}l on an empty line applies the empty-range register rule`,
      initial: { text: "\ndef", cursor: { line: 0, col: 0 }, register: "seed" },
      keys: [op, "l", ...(op === "c" ? ["X", "\x1b"] : [])],
    },
  ]),
  {
    name: "yl2p uses a charwise single-character register",
    initial: { text: "abc", cursor: { line: 0, col: 0 } },
    keys: ["y", "l", "2", "p"],
  },
];

describe("nvim parity motion corrections", () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      await assertMatchesNvim(testCase);
    });
  }
});
