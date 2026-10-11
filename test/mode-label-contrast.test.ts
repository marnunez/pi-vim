import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { buildModeColorizers, resolveModeColors } from "../mode-colors.js";

const reverse = (s: string) => `\x1b[7m${s}\x1b[27m`;
const palettes = [
  {
    name: "dark violet",
    base: "#191724",
    borderMuted: "#26233a",
    muted: "#908caa",
  },
  {
    name: "dark navy",
    base: "#0b132b",
    borderMuted: "#1c2c50",
    muted: "#a8b5c9",
  },
];

function rgb(hex: string): number[] {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
}

function emittedForeground(text: string): number[] {
  const opening = "\x1b[38;2;";
  const start = text.indexOf(opening);
  assert.ok(start >= 0, "native theme must emit a truecolour foreground");
  return text
    .slice(start + opening.length)
    .split("m")[0]
    .split(";")
    .map(Number);
}

function contrast(first: number[], second: number[]): number {
  const luminance = (color: number[]) =>
    color
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("INSERT label contrast", () => {
  // UI paint policy, not Vim semantics. Model a dark terminal whose background
  // matches the theme base: reverse video makes that the label's foreground.
  for (const palette of palettes) {
    it(`uses readable theme text rather than a near-background border (${palette.name})`, () => {
      const theme = new Theme(
        {
          borderMuted: palette.borderMuted,
          muted: palette.muted,
          text: "#ffffff",
          thinkingXhigh: "#ffffff",
        } as ConstructorParameters<typeof Theme>[0],
        { selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
        "truecolor",
      );
      const label = buildModeColorizers(
        theme,
        resolveModeColors(),
        reverse,
      ).insert(" INSERT ");
      assert.equal(label, theme.fg("muted", reverse(" INSERT ")));
      assert.deepEqual(emittedForeground(label), rgb(palette.muted));
      assert.ok(contrast(rgb(palette.base), emittedForeground(label)) >= 4.5);
      const oldLabel = theme.fg("borderMuted", reverse(" INSERT "));
      assert.ok(contrast(rgb(palette.base), emittedForeground(oldLabel)) < 1.5);
    });
  }

  it("preserves an explicit insert token, including borderMuted", () => {
    const calls: string[] = [];
    const theme = {
      fg(token: string, text: string) {
        calls.push(token);
        return text;
      },
    };
    const colors = resolveModeColors({ insert: "borderMuted" });
    assert.equal(
      buildModeColorizers(theme, colors, reverse).insert(" INSERT "),
      reverse(" INSERT "),
    );
    assert.deepEqual(calls, ["borderMuted"]);
  });
});
