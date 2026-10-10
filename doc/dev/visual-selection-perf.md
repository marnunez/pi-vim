# Visual selection render evidence

Measured on nix-desktop, Node v24.20.0, Pi peers 0.87.1. Baseline is fork commit `d2d5d24` (before highlighting); after is the highlight implementation with range alignment and the ANSI-boundary fix. Run the same parent-owned harness against both entries, back to back:

```sh
PIVIM_ENTRY=/path/to/baseline/index.ts node --import tsx/esm script/visual-render-bench.ts
node --import tsx/esm script/visual-render-bench.ts
```

The baseline checkout needs compatible dependencies. Fixtures have 80 warm-up frames, then 11 rounds of 120 operations. Most operations render an unchanged frame; moving selections swap endpoints before rendering, and resize alternates widths. Setup and bracketed-paste insertion are outside measurement. All clipboard writes are disabled. Each replay checks that text, expanded paste payloads and the register stay unchanged. Values are microseconds per frame (including the endpoint input in the moving fixture).

| Fixture | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Normal short, 80 columns | 5.16 | 4.38 | 6.41 | 5.23 |
| Insert long, 80 columns | 408.29 | 412.73 | 413.64 | 419.81 |
| Visual short, 80 columns | 3.14 | 18.18 | 3.73 | 20.65 |
| Visual endpoint movement, 80 columns | 4.85 | 20.51 | 6.23 | 22.49 |
| Visual long/wrapped, 80 columns | 406.96 | 507.91 | 412.60 | 518.79 |
| Visual resize, 20/80 columns | 421.47 | 512.02 | 427.01 | 541.68 |
| Visual Unicode/wrapped, 20 columns | 184.04 | 257.31 | 185.27 | 261.93 |
| V-LINE scrolling, 400 logical lines | 16.31 | 117.79 | 17.30 | 230.39 |
| Visual collapsed paste, 20 columns | 9.91 | 20.29 | 10.61 | 27.90 |

This is a feature cost, not a performance improvement: Visual rendering adds source-row validation and ANSI composition. The long fixtures add around 0.07–0.10 ms median; all measured frames remain below 0.55 ms at p95. The normal/insert path does not invoke the selection adapter, and its small differences are within run variation. These fixtures do not establish a bound for arbitrarily large buffers or slower machines.

There is exactly one host layout call per render. The adapter temporarily intercepts `layoutText`, restores its descriptor in `finally`, and validates the supported hosts' contiguous/lossless row partition and viewport geometry before painting visible rows. It does not duplicate host word wrapping or add an idle-render cache. Existing cursor-shape side effects still run before painting; the optimization prerequisites in `render-perf-strategy.md` remain deferred.

Focused tests observe ANSI cell inverse state, resets/colours, cursor markers, logical text/cursor/mode/register/history/paste metadata, and clearing/toggling selection. Fourteen curated Neovim comparisons render between every input so painting cannot silently change y/d/c behaviour. A scratch real Pi 0.87.1 process with only the new editor enabled also emitted verified charwise (`alpha`), whole-line and Unicode (`界 `) reverse-video spans, without model requests or clipboard writes. This is terminal integration smoke coverage, not a claim of human colour/contrast acceptance in every terminal/theme. The local maintainer terminal checklist is outside the published tree at `~/.local/share/pi-vim/maintainer-qa.md`.
