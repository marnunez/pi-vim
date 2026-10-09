# Motion-correction performance evidence

Baseline: `e55b07c05b648f3bbccf656c2b0c6ec63f1a91d1`.
Both builds used Node v24.20.0 and Pi coding-agent/pi-tui 0.87.1.
Clipboard access was stubbed. These are microbenchmarks, not terminal latency
measurements. No render optimization or cache change is part of this patch.

## Existing input hot-path input set

Run `node --import tsx/esm script/hotpath-compare.ts` on each build; select
another build with `PIVIM_ENTRY=/path/to/baseline/index.ts`. Eight samples per
metric, using the harness's existing iterations and fixtures.

| Metric | Before median µs/op | After median µs/op | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| no-op key | 0.735 | 0.590 | 0.918 | 0.814 |
| h on 4k line | 509.329 | 196.273 | 536.757 | 203.511 |
| w on 50-word line | 1.646 | 1.480 | 2.125 | 1.835 |
| insert typing | 9.541 | 10.183 | 10.216 | 10.628 |
| insert edit | 15.327 | 14.278 | 17.083 | 17.316 |

Normal h now sets a calculated, line-local grapheme column directly instead
of delegating each step to the host editor. Insert and visual paths are
unchanged. Small unrelated differences should be treated as run-to-run noise.

## Focused operator input set

Run `node --import tsx/esm script/motion-corrections-bench.ts`, with the same
`PIVIM_ENTRY` override for the baseline. Eight samples of 300 commands;
buffer/cursor restoration and clipboard work are outside the measured interval.

| Fixture | Before median µs/command | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| cw short ASCII | 6.14 | 7.94 | 12.79 | 11.68 |
| cw 4k ASCII | 10.44 | 250.05 | 11.86 | 269.87 |
| ce 4k ASCII control | 240.35 | 247.53 | 241.58 | 278.58 |
| cw Unicode | 4.55 | 7.02 | 5.59 | 7.11 |
| dw across newline | 3.47 | 3.48 | 4.04 | 4.74 |
| 2dw terminal newline | 4.73 | 5.04 | 5.22 | 7.05 |
| dw Unicode/newline | 3.54 | 3.33 | 3.75 | 3.39 |

The long-line cw regression is real: the old, incorrect exclusive w path did
not need inclusive grapheme-end resolution, while corrected cw uses the
existing inclusive ce machinery. The ce control shows that the corrected cw
cost matches that existing path (about 0.25 ms for a 4k ASCII word). This is a
correctness change, not a claimed operator optimization. Avoid introducing a
new grapheme cache or unrelated fast path in this fix; those need their own
measurement and invalidation review.

This input set does not measure real terminal paint, paste widgets, or memory
retention. The render strategy's idle-invocation experiment remains out of scope.
