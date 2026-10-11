# Native clipboard bridge evidence

## Compatibility fix

Pi 0.87.1 no longer includes `@mariozechner/clipboard`. Its text reader is `readClipboardText()` in the distributed `dist/utils/clipboard.js`; it is not exported from the public SDK index. The helper now uses that reader when present. Pi 0.78.0 has no such function and keeps its optional legacy package. This is an intentionally version-tested private distribution path, not a claim that every future Pi release has the same layout.

A native reader returning null or throwing is unavailable: the helper exits unsuccessfully and the editor can fall back to the unnamed register. It does not retry a different legacy clipboard backend, which could return stale data. A returned empty string remains a successful empty read. Legacy `hasText() === false` keeps its previous empty-read behaviour. Whitespace, Unicode and original line endings are not trimmed.

The running CLI's SDK takes precedence over an extension-local physical peer. The bundled/unbundled CLI fallback validates the SDK package name and distributed index, rather than assuming the installation directory is named `pi-coding-agent`. That supports the Nix `pi-monorepo` layout and avoids accidentally choosing an older development SDK. Helpers remain lazily constructed; virtual/compiled entrypoints without readable SDK files cannot break editor activation.

The existing 750 ms synchronous deadline and 1 MiB output cap remain. On POSIX, the read helper owns a detached process group; failed/timed-out reads kill that group so native reader tool children such as `wl-paste` cannot outlive the deadline. Node's spawnSync runtime accepts the common detached option although its TypeScript option type omits it. Linux tests observe the real child process lifecycle, not only the passed option. Windows does not use POSIX group signalling.

No change was made to clipboard mirroring policy, pending/failed/skipped-mirror preference, put geometry, register contents, cursor styling or Visual highlighting. Clipboard reading remains a Pi UI source rather than a new Vim register semantic. No runtime dependency or packed file was added.

## Tests

- Synthetic current-reader fixtures contain no legacy package, preserving empty text, whitespace, combining characters, emoji and CRLF/newline payloads.
- Null/exception fixtures include a deliberately wrong legacy reader and prove it is not used after current-reader failure.
- Older-reader fixtures exercise the optional package and no-text guard without touching the desktop clipboard.
- SDK fixtures cover the actual Nix directory name, ordinary/renamed directories, bundled/unbundled entrypoints, symlinks where supported, old/current metadata names, malformed/unrelated metadata and missing distribution files.
- Managed Jiti integration includes a conflicting local SDK. Default readers and writers use the CLI host, observe later external copies, and round-trip only a synthetic clipboard file. An actual ModalEditor with its default reader pastes external text rather than its stale unnamed register, retaining observable put/undo/redo behaviour.
- A stalled synthetic native reader spawns an owned child; the deadline returns null and the child is no longer running afterwards.
- Four new Neovim cases compare current-helper charwise/count/Unicode/linewise puts. Oracle byte columns are converted to Pi UTF-16 offsets. These joins perform no real clipboard writes. Existing register/mirroring tests remain in force.

Both Pi 0.78.0 and 0.87.1 passed 1006 unit tests and 421 curated Neovim comparisons, with 22 existing documented skips. The consumer smoke test also passes. Runtime/system clipboard verification is performed on Linux; this does not claim native macOS/Windows desktop QA.

## Synthetic read benchmark

Measured on nix-desktop, Node v24.20.0. Baseline is `7b5286e`; the same fixture includes both equivalent legacy and current readers. Thus the baseline has a working synthetic old backend rather than measuring a fast failure. All child environments remove display access; no desktop clipboard text is read or changed.

```sh
PIVIM_CLIPBOARD_ENTRY=/path/to/7b5286e/clipboard-mirror.ts node --import tsx/esm script/clipboard-read-bench.ts
node --import tsx/esm script/clipboard-read-bench.ts
```

Five warm-up reads precede eleven rounds of five reads. Timing includes child-process startup, module loading and returning the fixture bytes, not real desktop backend latency. Values are milliseconds per read.

| Fixture | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Short text | 23.86 | 24.32 | 25.53 | 25.02 |
| Unicode/newline text | 24.39 | 24.89 | 25.50 | 25.44 |

The roughly half-millisecond median increase is small compared with process startup. These numbers are not a speed-up or a bound on a real compositor. The outer read deadline is unchanged, and the renderer is untouched. Live smoke procedures and observations are kept in the local maintainer runbook at `~/.local/share/pi-vim/maintainer-qa.md`; private clipboard contents must never enter logs or assertions that print the compared values.
