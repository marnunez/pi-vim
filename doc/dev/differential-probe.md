# Bounded differential motion probe

Run from this checkout with existing development dependencies and `nvim` on PATH:

```sh
npm run test:differential -- /path/to/baseline-checkout
```

The baseline must be a compatible older pi-vim source checkout with its dependencies already installed. For this correctness fork, the reference is upstream commit `e55b07c05b648f3bbccf656c2b0c6ec63f1a91d1` (0.14.2), tested with Pi 0.87.1 dependencies on both sides. The command writes no repository files and installs nothing.

The probe retains the review's exact bounded input set: 15 ASCII buffers, first/last cursor columns on every logical line, `d`/`c` with `w`/`W`, and counts 1/2/3. These generate 636 cases. Two workers compare text, cursor, mode and unnamed register with headless Neovim. Twelve original finding reproductions run separately.

A regression means the new checkout differs from Neovim where the baseline matched it. The process exits nonzero if an original finding fails, a new regression occurs, or the oracle fails. Cases where both builds differ from Neovim are reported separately and do not fail this development probe; they are not claims of parity.

After the counted-change and exclusive-linewise endpoint fixes, the unchanged review probe and this retained harness report:

- 12 original reproductions pass;
- 636 comparisons complete, no introduced regressions or oracle errors;
- 36 remaining mismatches also present in baseline.

The ordinary curated parity suites remain stricter and independent: every enabled case must match Neovim. This optional probe supplements them; it does not replace `npm test` or `npm run test:nvim`, and is not currently part of CI.
