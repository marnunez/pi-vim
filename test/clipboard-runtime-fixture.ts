import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildClipboardReadHelperSource } from "../clipboard-mirror.js";

export function fixtureClipboardReader(moduleUrl: string): () => string | null {
  const source = buildClipboardReadHelperSource(moduleUrl);
  return () => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        encoding: "utf8",
        timeout: 750,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          DISPLAY: "",
          WAYLAND_DISPLAY: "",
          XDG_RUNTIME_DIR: "/nonexistent/pi-vim-test",
          PATH: "",
        },
      },
    );
    return result.error || result.status !== 0 || result.signal
      ? null
      : result.stdout;
  };
}

/** Synthetic SDK/backend: no OS clipboard calls, display access or OSC 52. */
export function clipboardRuntimeFixture(
  options: {
    directory?: string;
    packageName?: string;
    utilitySource?: string;
    legacySource?: string;
    text?: string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "pi-vim-clipboard-runtime-"));
  const sdk = join(root, options.directory ?? "pi-monorepo");
  const dist = join(sdk, "dist");
  const payload = join(root, "clipboard.txt");
  const writes = join(root, "writes.jsonl");
  mkdirSync(join(dist, "bundle"), { recursive: true });
  mkdirSync(join(dist, "utils"), { recursive: true });
  writeFileSync(
    join(sdk, "package.json"),
    JSON.stringify({
      name: options.packageName ?? "@earendil-works/pi-coding-agent",
      type: "module",
    }),
  );
  writeFileSync(payload, options.text ?? "external copied text");
  writeFileSync(
    join(dist, "index.js"),
    `
import { appendFileSync, writeFileSync } from 'node:fs';
export function copyToClipboard(text) {
  appendFileSync(${JSON.stringify(writes)}, JSON.stringify(text) + '\\n');
  writeFileSync(${JSON.stringify(payload)}, text);
}
`,
  );
  writeFileSync(join(dist, "cli.js"), "// synthetic unbundled entry\n");
  writeFileSync(join(dist, "bundle", "cli.js"), "// synthetic bundled entry\n");
  writeFileSync(
    join(dist, "utils", "clipboard.js"),
    options.utilitySource ?? "export {};\n",
  );
  if (options.legacySource !== undefined) {
    const legacy = join(sdk, "node_modules", "@mariozechner", "clipboard");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(
      join(legacy, "package.json"),
      JSON.stringify({ name: "@mariozechner/clipboard", main: "index.cjs" }),
    );
    writeFileSync(join(legacy, "index.cjs"), options.legacySource);
  }
  return {
    root,
    sdk,
    dist,
    payload,
    writes,
    moduleUrl: pathToFileURL(join(dist, "index.js")).href,
    cli: join(dist, "cli.js"),
    bundledCli: join(dist, "bundle", "cli.js"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
