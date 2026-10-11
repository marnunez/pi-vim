# Theme selection and cursor redraw evidence

Measured on nix-desktop, Node v24.20.0, Pi 0.87.1. Baseline is fork commit `39972a9`; after is the theme-background and cursor-redraw implementation. These are feature/reliability changes, not an optimisation. No runtime dependencies or additional packed files were added.

## Themed Visual render replay

Use the same updated harness for both checkouts:

```sh
PIVIM_ENTRY=/path/to/39972a9/index.ts node --import tsx/esm script/visual-render-bench.ts
node --import tsx/esm script/visual-render-bench.ts
```

The harness supplies a real Pi `Theme.bg('selectedBg', text)` callback. The baseline ignores this new constructor option and uses reverse video; the new editor exercises the actual themed path. Fixtures, rounds and state-invariance assertions are unchanged from [the initial selection measurements](visual-selection-perf.md). Values are microseconds per frame.

| Fixture | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Normal short, 80 columns | 4.35 | 4.41 | 5.31 | 5.30 |
| Insert long, 80 columns | 416.16 | 407.12 | 419.90 | 410.82 |
| Visual short, 80 columns | 19.88 | 20.53 | 20.53 | 22.57 |
| Visual endpoint movement | 20.29 | 21.51 | 24.58 | 24.11 |
| Visual long/wrapped | 531.59 | 507.14 | 634.15 | 540.10 |
| Visual resizing, 20/80 columns | 510.32 | 510.21 | 520.98 | 528.24 |
| Visual Unicode/wrapped | 256.42 | 252.67 | 288.69 | 254.71 |
| V-LINE scrolling, 400 lines | 120.12 | 118.48 | 195.03 | 192.16 |
| Visual collapsed paste | 21.00 | 28.25 | 28.95 | 29.06 |

The theme helper is resolved once per Visual frame. Existing host background changes and resets are tracked so the highlight neither disappears inside a selection nor leaks past it. The non-Visual render path remains unchanged. Small apparent improvements are run variation, not evidence of a speed-up; the collapsed-paste fixture adds about 7 microseconds median. Measured after p95 is below 0.55 ms, not a bound for other buffers or machines.

## Terminal-write guard replay

```sh
PIVIM_CURSOR_ENTRY=/path/to/39972a9/cursor-shape.ts node --import tsx/esm script/cursor-redraw-bench.ts
node --import tsx/esm script/cursor-redraw-bench.ts
```

Eleven rounds of 20,000 writes follow a 20,000-write warm-up. The terminal sink only counts bytes; real terminal I/O is deliberately excluded. Values are microseconds per write.

| Fixture | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Cursor positioning only | 0.009 | 0.017 | 0.010 | 0.019 |
| Short status frame | 0.001 | 0.095 | 0.001 | 0.102 |
| 8 KB frame | 0.001 | 0.111 | 0.001 | 0.113 |
| 64 KB intermediate chunk | 0.009 | 0.412 | 0.018 | 0.416 |

Pi's regular renderer ends synchronized output before repositioning the hardware cursor. With hardware-cursor mode enabled, the published frame can therefore briefly show it at the end of the updated line. The guard inserts cursor-hide immediately after each synchronized-output opening; Pi still handles all positioning and visibility restoration. Fullscreen restores its cursor inside the frame, which remains intact. Ordinary writes pass through unchanged. Guards are reference-counted, released on editor recreation/shutdown, and do not overwrite another extension's later writer wrapper.

## Correctness evidence

- The actual Pi main-screen renderer is exercised with full, idle, status-only, editor-text and marker-free frames. Tests observe cursor visibility at frame publication and final cursor coordinates. The old implementation fails this regression; the guarded implementation passes.
- Focused ANSI cell-state tests cover background resets, standard/indexed/truecolour/colon colours, foreground/formatting/link preservation, cursor markers, terminal-default selection backgrounds, live theme replacement and reverse-video fallback.
- The same 14 curated Neovim cases now paint with theme backgrounds between every input and switch background between renders. Text, cursor, mode and register still match Neovim; painting is intentionally a Pi UI policy, not a Vim semantic change.
- Extension lifecycle tests mount immediately, recreate on the same or another terminal, shut down, and observe original writer/hardware-setting restoration and unmodified subsequent frames.

Real-terminal smoke and human contrast acceptance are recorded separately in the local maintainer runbook, `~/.local/share/pi-vim/maintainer-qa.md`. Simulated cursor visibility does not establish how every terminal emulator paints a frame.
