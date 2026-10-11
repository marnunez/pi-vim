import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildClipboardReadHelperSource,
  resolvePiCodingAgentModuleUrlFromCli,
} from "../clipboard-mirror.js";
import { clipboardRuntimeFixture } from "./clipboard-runtime-fixture.js";

function readHelper(source: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    timeout: 750,
    maxBuffer: 1024 * 1024,
    // Defence against a faulty resolver accidentally accessing the real desktop.
    env: {
      ...process.env,
      DISPLAY: "",
      WAYLAND_DISPLAY: "",
      XDG_RUNTIME_DIR: "/nonexistent/pi-vim-test",
      PATH: "",
    },
  });
}

describe("Pi clipboard reader compatibility", () => {
  for (const text of ["", "  whitespace\t", "界 e\u0301 🙂\r\nsecond line\n"]) {
    it(`preserves native reader text exactly (${JSON.stringify(text)})`, () => {
      const fixture = clipboardRuntimeFixture({
        utilitySource: `export async function readClipboardText() { return ${JSON.stringify(text)}; }`,
      });
      try {
        const result = readHelper(
          buildClipboardReadHelperSource(fixture.moduleUrl),
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, text);
      } finally {
        fixture.cleanup();
      }
    });
  }

  for (const source of [
    "export async function readClipboardText() { return null; }",
    "export async function readClipboardText() { throw new Error('unavailable'); }",
  ]) {
    it(`preserves failure as register fallback, not a stale legacy read (${source.includes("throw") ? "throw" : "null"})`, () => {
      const fixture = clipboardRuntimeFixture({
        utilitySource: source,
        legacySource:
          "module.exports = {hasText: () => true, getText: () => 'WRONG LEGACY TEXT'};",
      });
      try {
        const result = readHelper(
          buildClipboardReadHelperSource(fixture.moduleUrl),
        );
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, "");
      } finally {
        fixture.cleanup();
      }
    });
  }

  it("uses the older optional backend when Pi has no native reader", () => {
    const fixture = clipboardRuntimeFixture({
      legacySource:
        "module.exports = {hasText: async () => true, getText: async () => 'legacy text\\n'};",
    });
    try {
      const result = readHelper(
        buildClipboardReadHelperSource(fixture.moduleUrl),
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "legacy text\n");
    } finally {
      fixture.cleanup();
    }
  });

  it("keeps legacy no-text reads empty without calling getText", () => {
    const fixture = clipboardRuntimeFixture({
      legacySource:
        "module.exports = {hasText: () => false, getText: () => {throw new Error('must not read');}};",
    });
    try {
      const result = readHelper(
        buildClipboardReadHelperSource(fixture.moduleUrl),
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
    } finally {
      fixture.cleanup();
    }
  });

  it("fails safely when neither reader is available", () => {
    const fixture = clipboardRuntimeFixture();
    try {
      const result = readHelper(
        buildClipboardReadHelperSource(fixture.moduleUrl),
      );
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
    } finally {
      fixture.cleanup();
    }
  });
});

describe("Pi clipboard SDK resolution", () => {
  it("bounds native reads and kills descendants when the helper times out", {
    skip: process.platform !== "linux",
  }, () => {
    const fixture = clipboardRuntimeFixture();
    try {
      const pidFile = join(fixture.root, "reader-child.pid");
      writeFileSync(
        join(fixture.dist, "utils", "clipboard.js"),
        `
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
export async function readClipboardText(){
  const child=spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  await new Promise(()=>{});
}
`,
      );
      const bridge = join(fixture.root, "clipboard-mirror.ts");
      copyFileSync(
        fileURLToPath(new URL("../clipboard-mirror.ts", import.meta.url)),
        bridge,
      );
      const require = createRequire(
        import.meta.resolve("@earendil-works/pi-coding-agent"),
      );
      const source = `
import {createJiti} from ${JSON.stringify(pathToFileURL(require.resolve("jiti")).href)};
import {readFileSync} from 'node:fs';
process.argv[1]=${JSON.stringify(fixture.bundledCli)};
const jiti=createJiti(import.meta.url, {moduleCache:false, tryNative:false});
const bridge=await jiti.import(${JSON.stringify(bridge)});
const start=Date.now(); const value=bridge.readClipboardInChildProcess(); const elapsed=Date.now()-start;
const pid=Number(readFileSync(${JSON.stringify(pidFile)}, 'utf8'));
await new Promise(resolve=>setTimeout(resolve,100));
let running=false;
try { running=readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1].split(' ')[0] !== 'Z'; } catch(e) { if(e.code!=='ENOENT') throw e; }
if(running) process.kill(pid, 'SIGKILL'); // Test cleanup if the regression returns.
console.log(JSON.stringify({unavailable:value===null, elapsed, running}));
`;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", source],
        { encoding: "utf8", timeout: 5000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const observed = JSON.parse(result.stdout) as {
        unavailable: boolean;
        elapsed: number;
        running: boolean;
      };
      assert.equal(observed.unavailable, true);
      assert.equal(
        observed.running,
        false,
        "timed-out reader must not leave native tool children alive",
      );
      assert.ok(
        observed.elapsed >= 700 && observed.elapsed < 1500,
        `read exceeded its 750 ms deadline: ${observed.elapsed}`,
      );
    } finally {
      fixture.cleanup();
    }
  });
  for (const directory of [
    "pi-monorepo",
    "pi-coding-agent",
    "renamed SDK with spaces",
  ]) {
    it(`resolves metadata-identified bundled and unbundled hosts (${directory})`, () => {
      const fixture = clipboardRuntimeFixture({ directory });
      try {
        assert.equal(
          resolvePiCodingAgentModuleUrlFromCli(fixture.cli),
          fixture.moduleUrl,
        );
        assert.equal(
          resolvePiCodingAgentModuleUrlFromCli(fixture.bundledCli),
          fixture.moduleUrl,
        );
        // Windows symlink creation can require privileges; direct/bundled
        // metadata resolution above remains covered on every platform.
        if (process.platform !== "win32") {
          const link = join(fixture.root, "pi");
          symlinkSync(fixture.bundledCli, link);
          assert.equal(
            resolvePiCodingAgentModuleUrlFromCli(link),
            fixture.moduleUrl,
          );
        }
      } finally {
        fixture.cleanup();
      }
    });
  }

  it("recognises legacy package names and rejects unrelated or incomplete distributions", () => {
    const fixture = clipboardRuntimeFixture({
      packageName: "@mariozechner/pi-coding-agent",
    });
    try {
      assert.equal(
        resolvePiCodingAgentModuleUrlFromCli(fixture.cli),
        fixture.moduleUrl,
      );
      writeFileSync(
        join(fixture.sdk, "package.json"),
        JSON.stringify({ name: "unrelated-package" }),
      );
      assert.equal(
        resolvePiCodingAgentModuleUrlFromCli(fixture.cli),
        undefined,
      );
      writeFileSync(join(fixture.sdk, "package.json"), "invalid JSON");
      assert.equal(
        resolvePiCodingAgentModuleUrlFromCli(fixture.cli),
        undefined,
      );
      writeFileSync(
        join(fixture.sdk, "package.json"),
        JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
      );
      rmSync(join(fixture.dist, "index.js"));
      assert.equal(
        resolvePiCodingAgentModuleUrlFromCli(fixture.cli),
        undefined,
      );
      assert.equal(resolvePiCodingAgentModuleUrlFromCli(undefined), undefined);
      assert.equal(
        resolvePiCodingAgentModuleUrlFromCli("/$bunfs/virtual/pi"),
        undefined,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("managed default helpers use the running host, not a conflicting local SDK, and see later copies", () => {
    const fixture = clipboardRuntimeFixture();
    try {
      writeFileSync(
        join(fixture.dist, "utils", "clipboard.js"),
        `import {readFileSync} from 'node:fs'; export async function readClipboardText(){return readFileSync(${JSON.stringify(fixture.payload)}, 'utf8');}`,
      );
      const extension = join(fixture.root, "extension");
      mkdirSync(extension);
      const bridge = join(extension, "clipboard-mirror.ts");
      copyFileSync(
        fileURLToPath(new URL("../clipboard-mirror.ts", import.meta.url)),
        bridge,
      );
      const shadow = join(
        extension,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
      );
      mkdirSync(join(shadow, "dist"), { recursive: true });
      writeFileSync(
        join(shadow, "package.json"),
        JSON.stringify({
          name: "@earendil-works/pi-coding-agent",
          type: "module",
          main: "dist/index.js",
        }),
      );
      writeFileSync(
        join(shadow, "dist", "index.js"),
        "throw new Error('wrong local SDK');",
      );
      const require = createRequire(
        import.meta.resolve("@earendil-works/pi-coding-agent"),
      );
      const jitiUrl = pathToFileURL(require.resolve("jiti")).href;
      const source = `
import {createJiti} from ${JSON.stringify(jitiUrl)};
import {readFileSync, writeFileSync} from 'node:fs';
process.argv[1] = ${JSON.stringify(fixture.bundledCli)};
const jiti=createJiti(import.meta.url, {moduleCache:false, tryNative:false, virtualModules:{'@earendil-works/pi-coding-agent':{}}});
const {readClipboardInChildProcess, writeClipboardInChildProcess}=await jiti.import(${JSON.stringify(bridge)});
const reads=[readClipboardInChildProcess()];
const sdk = await import(${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))});
const tui = await import(${JSON.stringify(import.meta.resolve("@earendil-works/pi-tui"))});
const editorJiti = createJiti(import.meta.url, {moduleCache:false, tryNative:false, virtualModules:{'@earendil-works/pi-coding-agent':sdk, '@earendil-works/pi-tui':tui}});
const {ModalEditor} = await editorJiti.import(${JSON.stringify(fileURLToPath(new URL("../index.ts", import.meta.url)))});
const editor = new ModalEditor({requestRender(){}, terminal:{rows:40,columns:80}}, {borderColor:s=>s}, {matches:()=>false});
editor.setText('ab'); editor.handleInput('\\x1b');
Object.assign(editor.state, {cursorLine:0, cursorCol:0}); editor.preferredVisualCol=null;
editor.setRegister('stale'); editor.handleInput('p');
const snapshot=()=>({text:editor.getText(),cursor:editor.getCursor(),mode:editor.getMode(),register:editor.getRegister()});
const pasted=snapshot(); editor.handleInput('u'); const undone=snapshot(); editor.handleInput('\\x12'); const redone=snapshot();
await writeClipboardInChildProcess('local yank', new AbortController().signal);
reads.push(readClipboardInChildProcess());
writeFileSync(${JSON.stringify(fixture.payload)}, 'later external copy');
reads.push(readClipboardInChildProcess());
console.log(JSON.stringify({reads, writes:readFileSync(${JSON.stringify(fixture.writes)}, 'utf8'), pasted, undone, redone}));
`;
      // Integration needs enough time for multiple bounded helper processes.
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", source],
        {
          encoding: "utf8",
          timeout: 5000,
          env: {
            ...process.env,
            DISPLAY: "",
            WAYLAND_DISPLAY: "",
            XDG_RUNTIME_DIR: "/nonexistent/pi-vim-test",
            PATH: "",
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        reads: ["external copied text", "local yank", "later external copy"],
        writes: '"local yank"\n',
        pasted: {
          text: "aexternal copied textb",
          cursor: { line: 0, col: 20 },
          mode: "normal",
          register: "stale",
        },
        undone: {
          text: "ab",
          cursor: { line: 0, col: 1 },
          mode: "normal",
          register: "stale",
        },
        redone: {
          text: "aexternal copied textb",
          cursor: { line: 0, col: 20 },
          mode: "normal",
          register: "stale",
        },
      });
      assert.equal(
        readFileSync(fixture.payload, "utf8"),
        "later external copy",
      );
    } finally {
      fixture.cleanup();
    }
  });
});
