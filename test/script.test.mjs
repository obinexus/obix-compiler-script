/**
 * obix-compiler-script — Phase 3 of the VueTS compiler recovery (docs/recovery/vuets-compiler.md).
 *
 * The script frontend compiles the normal `<script>` of a canonical SFC (no `<script setup>`: that is obix-compiler-script-setup) with the OFFICIAL Vue
 * script compiler (@vue/compiler-sfc `compileScript`) and reports what it says under OBIX diagnostic codes. These tests hold it to that: every expectation is
 * obtained from the official APIs (tests/vuets/oracle.mjs) and reduced to plain data BEFORE the code under test runs.
 *
 * Written before the implementation (RED), then satisfied (GREEN). The corpus is tests/corpus/vuets: every fixture is a byte-identical pair Foo.vue / Foo.obix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseObix, parseVueReference } from 'obix-compiler-parser';
import { toObixSfc } from 'obix-compiler-sfc';
import { compileObixScript, compileVueScript, OBIX_SCRIPT_CODES, OBIX_SCRIPT_MESSAGE_CODES, scriptCompilerVersion } from '../dist/index.js';
import { classifyFailure, classifyWarning } from '../dist/classify.js';
import { bodyOf, warningDiagnostic, failureDiagnostic, deferredDiagnostic } from '../dist/diagnostics.js';
import { runInstrumented, stripAnsi } from '../dist/instrument.js';
import { freezePosition } from '../dist/locate.js';
import { manifest, fixtureSource, officialScript, scriptIdOf, positionAt, pos, plainBindings } from '../../../tests/vuets/oracle.mjs';
import { assertStageResult, assertDiagnosticShape, assertLocated } from '../../../tests/vuets/script-assertions.mjs';

const PACKAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(import.meta.url);
const STAGE = (source, filename, options) => compileObixScript(toObixSfc(parseObix(source, filename)), options);
const VUE = (source, filename, options) => compileObixScript(toObixSfc(parseVueReference(source, filename)), options);
const SYNTAXES = [['obix', '.obix', STAGE], ['vue', '.vue', VUE]];
const byId = (id) => manifest.fixtures.find((f) => f.id === id);
const owns = (ref) => ref.owner === 'script';

// ── the surface ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the module exposes compileObixScript, the shared core, the code tables and the version of the official compiler it wraps — the pinned 3.5.43', () => {
  assert.equal(typeof compileObixScript, 'function');
  assert.equal(typeof compileVueScript, 'function');
  assert.equal(scriptCompilerVersion, requireHere('@vue/compiler-sfc/package.json').version);
  assert.equal(scriptCompilerVersion, '3.5.43');
  assert.deepEqual(Object.keys(OBIX_SCRIPT_CODES).sort(), ['compilerFailed', 'deferredExternalSrc', 'deferredLanguage', 'langMismatch', 'syntaxInvalid', 'unclassified']);
  assert.ok(Object.isFrozen(OBIX_SCRIPT_CODES) && Object.isFrozen(OBIX_SCRIPT_MESSAGE_CODES));
  for (const entry of OBIX_SCRIPT_MESSAGE_CODES) assert.ok(Object.isFrozen(entry) && entry.pattern instanceof RegExp && /^OBIX_SCRIPT_[A-Z_]+$/.test(entry.code), entry.code);
  for (const code of Object.values(OBIX_SCRIPT_CODES)) assert.match(code, /^OBIX_SCRIPT_[A-Z_]+$/, `${code}: a namespaced word list — no digit, so no Vue or Babel number`);
});

test('SSR boundary (directive, Bottleneck C): importing the package reads no browser global — the official compiler is loaded on first use — and compiling then works with the globals absent, as on a server', () => {
  const entry = pathToFileURL(path.join(PACKAGE, 'dist', 'index.js')).href;
  const parserEntry = import.meta.resolve('obix-compiler-parser');
  const sfcEntry = import.meta.resolve('obix-compiler-sfc');
  const script = `
    const names = ['window', 'self', 'document', 'HTMLElement', 'Element', 'MutationObserver', 'requestAnimationFrame'];
    const log = [];
    for (const n of names) Object.defineProperty(globalThis, n, { configurable: true, get() { log.push(n); throw new ReferenceError(n + ' is not defined (trap)'); } });
    const mod = await import(${JSON.stringify(entry)});
    const atImport = [...log];
    for (const n of names) delete globalThis[n];
    const { parseObix } = await import(${JSON.stringify(parserEntry)});
    const { toObixSfc } = await import(${JSON.stringify(sfcEntry)});
    const r = mod.compileObixScript(toObixSfc(parseObix('<script>export default { data() { return { n: 1 } } }</script>', 'Pure.obix')));
    process.stdout.write('@@' + JSON.stringify({ atImport, status: r.status, ok: r.ok, diagnostics: r.diagnostics.length, content: typeof r.artifact.content, version: mod.scriptCompilerVersion }));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  const m = /@@(.*)$/s.exec(r.stdout ?? '');
  assert.ok(m, `the probe died: ${(r.stderr ?? '').slice(0, 400)}`);
  const out = JSON.parse(m[1]);
  assert.deepEqual(out.atImport, [], 'importing the package must not read any browser global');
  assert.deepEqual([out.status, out.ok, out.diagnostics, out.content, out.version], ['compiled', true, 0, 'string', '3.5.43']);
});

test('the frontend is isolated from the frozen Level-0 track and from the runtime: no legacy import, no static import of the official compiler, and the only Vue-family dependency is @vue/compiler-sfc', () => {
  const dist = path.join(PACKAGE, 'dist');
  const specifiers = new Set();
  for (const file of fs.readdirSync(dist).filter((f) => f.endsWith('.js'))) {
    for (const m of fs.readFileSync(path.join(dist, file), 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)) specifiers.add(m[1]);
  }
  const external = [...specifiers].filter((s) => !s.startsWith('.'));
  assert.deepEqual(external.sort(), ['node:crypto', 'node:module', 'obix-compiler-diagnostics'], 'the official compiler is loaded on first use, by name, never by a static import; the diagnostic contract is imported for the one shared position function');
  const manifestJson = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'));
  const declared = Object.keys({ ...manifestJson.dependencies, ...manifestJson.devDependencies, ...manifestJson.peerDependencies });
  assert.deepEqual(declared.filter((n) => /legacy/.test(n)), []);
  assert.deepEqual(Object.keys(manifestJson.dependencies).filter((n) => n === 'vue' || n.startsWith('@vue/')), ['@vue/compiler-sfc']);
});

// ── the corpus and the manifest ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('every manifest expectation for the script stages is well formed: a status, and diagnostics that each state an OBIX script code and the text they point at', () => {
  const statuses = new Set(['compiled', 'failed', 'absent', 'deferred']);
  let expectations = 0;
  for (const f of manifest.fixtures) {
    if (!f.script) continue;
    expectations++;
    assert.ok(statuses.has(f.script.status), `${f.id}: status ${f.script.status}`);
    assert.ok(Array.isArray(f.script.diagnostics) && f.script.diagnostics.length > 0, `${f.id}: diagnostics`);
    for (const d of f.script.diagnostics) {
      assert.match(d.code, /^OBIX_SCRIPT_[A-Z_]+$/, `${f.id}: ${d.code}`);
      assert.ok(d.at === null || typeof d.at === 'string', `${f.id}: at`);
      assert.ok(d.severity === undefined || d.severity === 'warning', `${f.id}: severity`);
    }
  }
  assert.ok(expectations >= 40, `the negative and deferred fixtures of Phase 3 state their expectations (${expectations})`);
});

// ── THE GATE: the frontend equals the official reference, for every fixture, in both syntaxes ─────────────────────────────────────────────────

test('THE GATE — every corpus fixture, in both syntaxes: status, compiled script, binding metadata, imports, diagnostics and where they point equal what the official Vue compiler says', () => {
  let compared = 0;
  let owned = 0;
  for (const f of manifest.fixtures) {
    const source = fixtureSource(f);
    for (const [, ext, run] of SYNTAXES) {
      const filename = f.name + ext;
      const ref = officialScript(source, filename); // FIRST: the reference, as plain data
      const got = run(source, filename); //            THEN: the code under test
      if (assertStageResult(got, ref, { source, filename, expectation: f.script, label: `${f.id}${ext}`, kind: 'script', owns })) owned++;
      compared++;
    }
  }
  assert.equal(compared, manifest.fixtures.length * 2);
  assert.ok(compared >= 200, `${compared} comparisons`);
  assert.ok(owned >= 20, `${owned} of them are compiled by this stage`);
});

test('Foo.vue ≅ Foo.obix under the script stage: with the same id, the two results differ in nothing but the filename — same script, same bindings, same diagnostics', () => {
  const normalize = (r) => ({ ...r, filename: '<filename>', diagnostics: r.diagnostics.map((d) => ({ ...d, filename: '<filename>', detail: d.detail && d.detail.split(/\S+\.(?:vue|obix)/).join('<filename>') })) });
  let pairs = 0;
  for (const f of manifest.fixtures) {
    const source = fixtureSource(f);
    const a = normalize(VUE(source, `${f.name}.vue`, { id: 'same' }));
    const b = normalize(STAGE(source, `${f.name}.obix`, { id: 'same' }));
    assert.deepStrictEqual(a, b, f.id);
    if (a.artifact) assert.notEqual(a.artifact.scriptAst, b.artifact.scriptAst, `${f.id}: each compile owns its AST`);
    pairs++;
  }
  assert.equal(pairs, manifest.fixtures.length);
});

// ── the domain: what belongs to this stage ───────────────────────────────────────────────────────────────────────────────────────────────────

test('the stage compiles a normal <script> and nothing else: no script at all, and any file with a <script setup> (compiled together with its normal script by the setup stage) is `absent`', () => {
  for (const source of ['<template><p /></template>\n', '', '<style>.a{}</style>\n', '<script setup>const a = 1</script>\n', '<script>export const a = 1</script>\n<script setup>const b = 2</script>\n']) {
    const r = STAGE(source, 'None.obix');
    assert.deepEqual([r.status, r.ok, r.artifact, r.diagnostics], ['absent', true, null, []], JSON.stringify(source));
  }
  assert.equal(STAGE('<script>export const a = 1</script>\n', 'One.obix').status, 'compiled');
});

// ── the normal script, construct by construct (hard-coded facts, checked against the reference too) ────────────────────────────────────────────

test('a plain <script> is compiled with the official semantics: the source comes back as it is, and the binding metadata is the official analysis of the options object', () => {
  const f = byId('27-script-js');
  const source = fixtureSource(f);
  const r = STAGE(source, 'OptionsJs.obix');
  assert.equal(r.status, 'compiled');
  assert.deepEqual(r.diagnostics, []);
  const a = r.artifact;
  assert.deepEqual([a.kind, a.lang], ['script', null]);
  assert.equal(a.content, source.slice(source.indexOf('\nexport default'), source.indexOf('</script>')), 'nothing was rewritten: the content of the block, as written');
  assert.deepEqual({ ...a.bindings }, { label: 'props', step: 'props', count: 'data', doubled: 'options', increment: 'options' });
  assert.deepEqual(a.imports, []);
  assert.deepEqual([a.scriptRange.start.line, a.scriptRange.end.line, a.scriptRange.end.offset], [1, 19, source.indexOf('</script>')], 'where the block content lies in the file');
  assert.equal(a.setupRange, null);
  assert.ok(Array.isArray(a.scriptAst) && a.scriptAst.length === 1 && a.scriptAst[0].type === 'ExportDefaultDeclaration');
  assert.equal(a.scriptSetupAst, undefined);
});

test('<script lang="ts"> keeps its TypeScript: removing it is the TypeScript phase, not this one — and defineComponent() gives no bindings, as the official analysis reads only an object literal', () => {
  const source = fixtureSource(byId('27b-script-define-component'));
  const r = STAGE(source, 'DefineComponent.obix');
  assert.equal(r.status, 'compiled');
  assert.equal(r.artifact.lang, 'ts');
  assert.match(r.artifact.content, /data\(\): State \{/, 'TypeScript syntax is retained');
  assert.match(r.artifact.content, /bump\(by: number = 1\): void/);
  assert.match(r.artifact.content, /import \{ defineComponent \} from "obix"/, 'the authoring alias is not resolved here');
  assert.deepEqual({ ...r.artifact.bindings }, {});
  // an object literal, on the other hand, is analysed: props as an array, and what setup() returns
  const analysed = STAGE(fixtureSource(byId('27c-script-setup-return')), 'SetupReturn.obix').artifact;
  assert.deepEqual({ ...analysed.bindings }, { a: 'props', b: 'props', local: 'setup-maybe-ref', extra: 'setup-maybe-ref' });
});

test('named exports next to the default export are kept, and v-bind() in <style> makes the official compiler rewrite the default export and inject useCssVars — with the component id', () => {
  const named = STAGE(fixtureSource(byId('27d-script-named-exports')), 'NamedExports.obix').artifact;
  assert.match(named.content, /export const version = "1\.0"/);
  assert.match(named.content, /export function helper\(x: number\): number/);
  const source = fixtureSource(byId('27e-script-css-vars'));
  const derived = STAGE(source, 'NormalCssVars.obix').artifact.content;
  const id = scriptIdOf('NormalCssVars.obix');
  assert.match(derived, /const __default__ = \{/, 'the default export became a variable');
  assert.match(derived, /import \{ useCssVars as _useCssVars \} from 'vue'/);
  assert.ok(derived.includes(`"${id}-color"`), `the css variable is scoped by the component id ${id}`);
  assert.match(derived, /export default __default__/);
  const named2 = STAGE(source, 'NormalCssVars.obix', { id: 'abc123' }).artifact.content;
  assert.ok(named2.includes('"abc123-color"') && !named2.includes(id), 'an explicit id replaces the derived one');
});

test('the component id, when the caller gives none, is a stable function of the file name: the first 8 hex digits of its SHA-256 — so the output never depends on where a file lies or on the order of compilation', () => {
  assert.match(scriptIdOf('A.obix'), /^[0-9a-f]{8}$/);
  const source = fixtureSource(byId('27e-script-css-vars'));
  const a = STAGE(source, 'A.obix').artifact.content;
  const b = STAGE(source, 'B.obix').artifact.content;
  assert.notEqual(a, b, 'two files, two ids');
  assert.equal(a, STAGE(source, 'A.obix').artifact.content, 'the same file, the same id');
  assert.ok(a.includes(`"${scriptIdOf('A.obix')}-color"`) && b.includes(`"${scriptIdOf('B.obix')}-color"`));
});

test('<script lang="tsx"> compiles too — JSX is retained for the phase that transforms it — and an empty lang is no lang, as for the official tooling', () => {
  const tsx = STAGE(fixtureSource(byId('27i-script-tsx')), 'ScriptTsx.obix');
  assert.deepEqual([tsx.status, tsx.artifact.lang], ['compiled', 'tsx']);
  assert.match(tsx.artifact.content, /return <div \/>/);
  const empty = STAGE('<script lang="">export default { data() { return { n: 1 } } }</script>\n', 'Empty.obix');
  assert.deepEqual([empty.status, empty.artifact.lang, { ...empty.artifact.bindings }], ['compiled', '', { n: 'data' }]);
});

// ── diagnostics ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a syntax error is a diagnostic with Babel\'s own identity as metadata and the place Babel found — never an exception', () => {
  const f = byId('27f-script-syntax-error');
  const source = fixtureSource(f);
  const ref = officialScript(source, 'ScriptSyntax.vue');
  assert.equal(ref.kind, 'threw');
  const r = STAGE(source, 'ScriptSyntax.obix');
  assert.deepEqual([r.status, r.ok, r.artifact], ['failed', false, null]);
  const [d] = r.diagnostics;
  assert.equal(d.code, OBIX_SCRIPT_CODES.syntaxInvalid);
  assert.equal(d.message, 'Unexpected token, expected "," (7:0)', 'the official message, without its prefix and its code frame');
  assert.match(d.detail, /^\[vue\/compiler-sfc\] Unexpected token, expected "," \(7:0\)\n\nScriptSyntax\.obix\n\d+ {2}\| {2}/, 'the detail is the whole exception, code frame included');
  assert.deepEqual({ ...d.upstream }, { package: '@vue/compiler-sfc', version: '3.5.43', enum: 'BabelParserReasonCodes', name: ref.error.babel.reasonCode, code: 'BABEL_PARSER_SYNTAX_ERROR' });
  assert.equal(source.slice(d.start.offset, d.end.offset), '<');
  assert.equal(d.start.offset, source.indexOf('</script>'), 'the token Babel stopped at: the closing tag');
  assert.deepEqual([d.start.line, d.start.column], [7, 1]);
});

test('the place of a syntax error is the file\'s, not Babel\'s: Babel counts (line:column) from the start of the block, the diagnostic from the start of the file', () => {
  const source = '<template>\n  <p />\n</template>\n\n<script>\nexport default {\n  data() {\n    return { n: 1\n  }\n}\n</script>\n';
  const r = STAGE(source, 'Late.obix');
  const [d] = r.diagnostics;
  assert.equal(d.code, OBIX_SCRIPT_CODES.syntaxInvalid);
  assert.match(d.message, /\(7:0\)$/, 'Babel: line 7 of the block');
  assert.deepEqual([d.start.line, d.start.column], [11, 1], 'the file: the block starts on line 5, so the closing tag is on line 11');
  assertLocated(d, source, '<', 'late');
});

test('locations are file-absolute even when the file uses CRLF: line, column and offset are those of the whole file', () => {
  const source = ['<template>', '  <p />', '</template>', '', '<script>', 'export default {', '  data() {', '    return { n: 1', '  }', '}', '</script>', ''].join('\r\n');
  const r = STAGE(source, 'Crlf.obix');
  assert.equal(r.status, 'failed');
  const [d] = r.diagnostics;
  assert.equal(d.start.offset, source.indexOf('</script>'));
  assert.deepEqual([d.start.line, d.start.column], [11, 1]);
  assertLocated(d, source, '<', 'crlf');
});

test('valid Vue-compatible syntax that the frontend does not compile YET is a DEFERRED capability with its own status — not invalid syntax: <script src>, or a language the official compiler does not compile', () => {
  const src = STAGE(fixtureSource(byId('27g-script-src-deferred')), 'ScriptSrc.obix');
  assert.deepEqual([src.status, src.ok, src.artifact], ['deferred', false, null]);
  assert.deepEqual(src.diagnostics.map((d) => d.code), [OBIX_SCRIPT_CODES.deferredExternalSrc]);
  assert.match(src.diagnostics[0].message, /^<script src="\.\/ScriptSrc\.script\.ts"> is valid Vue-compatible SFC syntax, but resolving an external script file is a deferred capability/);
  const lang = STAGE(fixtureSource(byId('27h-script-lang-deferred')), 'ScriptLang.obix');
  assert.deepEqual([lang.status, lang.diagnostics.map((d) => d.code)], ['deferred', [OBIX_SCRIPT_CODES.deferredLanguage]]);
  assert.match(lang.diagnostics[0].message, /^<script lang="coffee"> is valid Vue-compatible SFC syntax, but script languages other than js, jsx, ts and tsx are a deferred capability/);
  assert.match(lang.diagnostics[0].message, /Only JavaScript and TypeScript/);
  // the official compiler compiles exactly js, jsx, ts and tsx: anything else — even a different spelling — is a preprocessor's job
  for (const other of ['TS', 'mts', 'JS', 'typescript', 'ts ']) {
    const r = STAGE(`<script lang="${other}">export default {}</script>\n`, 'Lang.obix');
    assert.deepEqual([r.status, r.diagnostics.map((d) => d.code)], ['deferred', [OBIX_SCRIPT_CODES.deferredLanguage]], other);
  }
  for (const good of ['js', 'jsx', 'ts', 'tsx']) assert.equal(STAGE(`<script lang="${good}">export default {}</script>\n`, 'Lang.obix').status, 'compiled', good);
  // deferred is a checked fact: the official compiler hands the block back untouched
  assert.deepEqual(officialScript('<script lang="TS">export default {}</script>\n', 'Lang.vue').official, { unchanged: true, hasBindings: false });
});

// ── totality: the stage never throws for a script, never prints, and leaves nothing behind ───────────────────────────────────────────────────

test('the stage never throws and never prints for a script, valid or not: what the official compiler says becomes diagnostics', () => {
  const calls = [];
  const originals = ['warn', 'error', 'log', 'info'].map((name) => [name, console[name]]);
  for (const [name] of originals) console[name] = (...args) => calls.push([name, ...args]);
  try {
    for (const f of manifest.fixtures) {
      const source = fixtureSource(f);
      assert.doesNotThrow(() => STAGE(source, `${f.name}.obix`), f.id);
      assert.doesNotThrow(() => VUE(source, `${f.name}.vue`), f.id);
    }
  } finally {
    for (const [name, fn] of originals) console[name] = fn;
  }
  assert.deepEqual(calls, []);
});

test('the official compiler runs inside a confined, restored environment: console.warn, NODE_ENV and the code-frame function it calls are exactly as they were — after a success and after a failure', () => {
  const shared = createRequire(requireHere.resolve('@vue/compiler-sfc'))('@vue/shared');
  const frame = shared.generateCodeFrame;
  const warn = console.warn;
  const failing = fixtureSource(byId('27f-script-syntax-error'));
  const fine = fixtureSource(byId('27-script-js'));
  const before = process.env.NODE_ENV;
  try {
    for (const env of [undefined, 'development', 'production', 'test']) {
      if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
      for (const source of [failing, fine]) {
        STAGE(source, 'Confined.obix');
        assert.equal(process.env.NODE_ENV, env, `NODE_ENV=${env} is restored`);
        assert.equal(Object.hasOwn(process.env, 'NODE_ENV'), env !== undefined, `NODE_ENV=${env}: set or unset as before`);
        assert.equal(console.warn, warn, 'console.warn is restored');
        assert.equal(shared.generateCodeFrame, frame, 'generateCodeFrame is restored');
      }
    }
  } finally {
    if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
  }
});

test('the environment does not change what a script means: NODE_ENV=production and development give the same result — the once-per-process hints of the official compiler are not part of it', () => {
  const ids = ['27-script-js', '27b-script-define-component', '27e-script-css-vars', '27f-script-syntax-error', '27g-script-src-deferred', '27h-script-lang-deferred', '16-script'];
  const probeIn = (env) => {
    const r = spawnSync(process.execPath, [path.join(PACKAGE, 'test', 'env-probe.mjs'), JSON.stringify(ids)], { encoding: 'utf8', env: { ...process.env, NODE_ENV: env } });
    const m = /@@(.*)$/s.exec(r.stdout ?? '');
    assert.ok(m, `the probe died under ${env}: ${(r.stderr ?? '').slice(0, 400)}`);
    const out = JSON.parse(m[1]);
    assert.equal(out.env, env);
    return out.rows;
  };
  const development = probeIn('development');
  const production = probeIn('production');
  assert.equal(development.length, ids.length);
  assert.deepEqual(production, development);
  assert.ok(development.some((row) => row.status === 'failed') && development.some((row) => row.content));
});

test('compiling is deterministic and pure: the same SFC gives deep-equal results with distinct ASTs, the SFC is untouched, and everything reported is frozen', () => {
  const sfc = toObixSfc(parseObix(fixtureSource(byId('27-script-js')), 'OptionsJs.obix'));
  const before = JSON.stringify(sfc);
  const a = compileObixScript(sfc);
  const b = compileObixScript(sfc);
  assert.deepStrictEqual(a, b);
  assert.notEqual(a.artifact.scriptAst, b.artifact.scriptAst);
  assert.equal(JSON.stringify(sfc), before);
  for (const r of [a, b]) assert.ok(Object.isFrozen(r) && Object.isFrozen(r.diagnostics) && Object.isFrozen(r.artifact) && Object.isFrozen(r.artifact.bindings) && Object.isFrozen(r.artifact.imports));
  const bad = STAGE(fixtureSource(byId('27f-script-syntax-error')), 'ScriptSyntax.obix');
  for (const d of bad.diagnostics) assert.ok(Object.isFrozen(d) && Object.isFrozen(d.upstream) && Object.isFrozen(d.start) && Object.isFrozen(d.end));
  const deferred = STAGE(fixtureSource(byId('27g-script-src-deferred')), 'ScriptSrc.obix');
  for (const d of deferred.diagnostics) assert.ok(Object.isFrozen(d) && Object.isFrozen(d.start) && Object.isFrozen(d.end));
});

test('the binding metadata is plain, frozen data that another stage can be handed: the caller\'s later changes and the official compiler\'s own object are out of reach', () => {
  const r = STAGE(fixtureSource(byId('27-script-js')), 'OptionsJs.obix');
  const bindings = r.artifact.bindings;
  assert.ok(Object.isFrozen(bindings));
  assert.throws(() => { 'use strict'; bindings.label = 'data'; }, TypeError);
  assert.deepEqual(plainBindings(bindings), plainBindings(officialScript(fixtureSource(byId('27-script-js')), 'OptionsJs.vue').bindings));
});

// ── the vocabulary ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the shared table classifies the messages any script can produce, by their exact text: a language mismatch, and the invariant the official compiler asserts', () => {
  const at = (message) => classifyFailure(new Error(`[@vue/compiler-sfc] ${message}`), message, OBIX_SCRIPT_MESSAGE_CODES);
  assert.equal(at('<script> and <script setup> must have the same language type.').code, OBIX_SCRIPT_CODES.langMismatch);
  assert.equal(at('registerBinding called without active scope, something is wrong.').code, OBIX_SCRIPT_CODES.compilerFailed);
  const unknown = at('a message from a newer Vue');
  assert.equal(unknown.code, OBIX_SCRIPT_CODES.unclassified);
  assert.deepEqual({ ...unknown.upstream }, { package: '@vue/compiler-sfc', version: '3.5.43', enum: null, name: null, code: null });
});

test('a failure that is not a diagnostic of the official compiler — an exception from inside it, or a value that is not an Error — is a failed result with a stable message and the raw text as detail', () => {
  const inside = classifyFailure(new TypeError("Cannot read properties of undefined (reading 'x')"), "Cannot read properties of undefined (reading 'x')", OBIX_SCRIPT_MESSAGE_CODES);
  assert.equal(inside.code, OBIX_SCRIPT_CODES.compilerFailed);
  assert.match(inside.message, /^The official Vue compiler \(@vue\/compiler-sfc 3\.5\.43\) could not compile this script\.$/);
  assert.equal(inside.detail, "Cannot read properties of undefined (reading 'x')");
  assert.equal(inside.upstream, undefined);
  const notAnError = classifyFailure('boom', 'boom', OBIX_SCRIPT_MESSAGE_CODES);
  assert.deepEqual([notAnError.code, notAnError.detail], [OBIX_SCRIPT_CODES.compilerFailed, 'boom']);
  const warning = classifyWarning('[@vue/compiler-sfc] something unforeseen', 'something unforeseen', OBIX_SCRIPT_MESSAGE_CODES);
  assert.deepEqual([warning.code, warning.message, warning.detail], [OBIX_SCRIPT_CODES.unclassified, 'something unforeseen', '[@vue/compiler-sfc] something unforeseen']);
  assert.deepEqual({ ...warning.upstream }, { package: '@vue/compiler-sfc', version: '3.5.43', enum: null, name: null, code: null });
});

// ── the shared core, for the kind that owns a <script setup> (the setup package adds the vocabulary of the macros) ───────────────────────────

test('the shared core reports what the official compiler printed and threw about a <script setup> — with the shared table alone, as unclassified — with the place it points at and nothing printed', () => {
  const core = (source, filename) => compileVueScript(toObixSfc(parseObix(source, filename)), 'script-setup', [], {});
  const printed = [];
  const original = console.warn;
  console.warn = (...args) => printed.push(args);
  let warned;
  let failed;
  const warnSource = fixtureSource(byId('29f-with-defaults-destructure-warning'));
  const failSource = fixtureSource(byId('29-duplicate-define-props'));
  try {
    warned = core(warnSource, 'W.obix');
    failed = core(failSource, 'F.obix');
  } finally {
    console.warn = original;
  }
  assert.deepEqual(printed, []);
  assert.deepEqual([warned.status, warned.ok, warned.diagnostics.map((d) => [d.code, d.severity])], ['compiled', true, [[OBIX_SCRIPT_CODES.unclassified, 'warning']]]);
  assertLocated(warned.diagnostics[0], warnSource, 'withDefaults', 'warning');
  assert.match(warned.diagnostics[0].detail, /^\[@vue\/compiler-sfc\] withDefaults\(\) is unnecessary/);
  assert.deepEqual([failed.status, failed.ok, failed.artifact, failed.diagnostics.map((d) => [d.code, d.severity])], ['failed', false, null, [[OBIX_SCRIPT_CODES.unclassified, 'error']]]);
  assertLocated(failed.diagnostics[0], failSource, 'defineProps<{ b: string }>()', 'failure');
  assert.equal(failed.diagnostics[0].message, 'duplicate defineProps() call');
  // a vocabulary given to the core is used, and the shared table is still consulted
  const custom = compileVueScript(toObixSfc(parseObix(failSource, 'F.obix')), 'script-setup', [{ pattern: /^duplicate defineProps\(\) call$/, code: 'OBIX_TEST_DUPLICATE' }], {});
  assert.equal(custom.diagnostics[0].code, 'OBIX_TEST_DUPLICATE');
  const mismatch = compileVueScript(toObixSfc(parseObix('<script lang="ts">a</script>\n<script setup>const n = 1</script>\n', 'M.obix')), 'script-setup', [], {});
  assert.deepEqual(mismatch.diagnostics.map((d) => d.code), [OBIX_SCRIPT_CODES.langMismatch], 'the shared table classifies it');
});

test('the core owns the blocks of its kind and only those: the same SFC is absent for the other kind, and a dual SFC belongs to the setup kind', () => {
  const dual = toObixSfc(parseObix('<script>export const a = 1</script>\n<script setup>const b = 2</script>\n', 'D.obix'));
  assert.equal(compileVueScript(dual, 'script', [], {}).status, 'absent');
  assert.equal(compileVueScript(dual, 'script-setup', [], {}).status, 'compiled');
  const normal = toObixSfc(parseObix('<script>export default {}</script>\n', 'N.obix'));
  assert.equal(compileVueScript(normal, 'script', [], {}).status, 'compiled');
  assert.equal(compileVueScript(normal, 'script-setup', [], {}).status, 'absent');
  for (const kind of ['script', 'script-setup']) {
    assert.throws(() => compileVueScript(normal, kind, [], { mode: 1 }), (e) => e instanceof TypeError && e.message.startsWith(kind === 'script' ? 'compileObixScript ' : 'compileObixScriptSetup '), kind);
  }
});

test('a diagnostic points where the official code frame says — and only where it can be trusted: a frame of another file, an empty frame, and a frame that is not what ends the report give no place', () => {
  const source = 'line one\nline two\nline three\n';
  const frame = { source, start: 9, end: 17, text: '2  |  line two\n   |  ^^^^^^^^' };
  const raw = `[@vue/compiler-sfc] the message\n\nF.obix\n${frame.text}`;
  const at = (f, text = raw) => failureDiagnostic(new Error(text), f, 'F.obix', source, []);
  const trusted = at(frame);
  assert.deepEqual([trusted.start.line, trusted.start.column, trusted.start.offset, trusted.end.line, trusted.end.column, trusted.end.offset], [2, 1, 9, 2, 9, 17]);
  assert.equal(source.slice(trusted.start.offset, trusted.end.offset), 'line two');
  assert.deepEqual([trusted.message, trusted.detail], ['the message', raw]);
  for (const bad of [undefined, { ...frame, source: 'another file' }, { ...frame, text: '' }, { ...frame, text: 'not the frame of this report' }]) {
    const d = at(bad);
    assert.equal(d.start, undefined, JSON.stringify(bad));
    assert.equal(d.end, undefined, JSON.stringify(bad));
  }
  // a warning: the same trust rules, colour removed, and the trailing newline the official compiler prints after it
  const printed = `\u001b[1m\u001b[33m[@vue/compiler-sfc]\u001b[0m\u001b[33m the warning\n\nF.obix\n${frame.text}\u001b[0m\n`;
  const w = warningDiagnostic({ raw: printed, frame }, 'F.obix', source, []);
  assert.deepEqual([w.severity, w.message, w.detail, w.start.offset, w.end.offset], ['warning', 'the warning', `[@vue/compiler-sfc] the warning\n\nF.obix\n${frame.text}`, 9, 17]);
  assert.equal(warningDiagnostic({ raw: printed, frame: undefined }, 'F.obix', source, []).start, undefined);
  assert.ok(Object.isFrozen(w) && Object.isFrozen(w.start) && Object.isFrozen(w.upstream));
});

test('the official decoration is removed from a message — the prefix (with and without the @ Babel\'s errors lack), and the file name and code frame after it — and nothing else', () => {
  assert.equal(bodyOf('[@vue/compiler-sfc] duplicate defineProps() call\n\nF.obix\n1  |  x\n   |  ^', 'F.obix'), 'duplicate defineProps() call');
  assert.equal(bodyOf('[vue/compiler-sfc] Unexpected token (3:0)\n\nF.obix\n1  |  x', 'F.obix'), 'Unexpected token (3:0)');
  assert.equal(bodyOf('[@vue/compiler-sfc] two\nlines\n\nF.obix\nframe', 'F.obix'), 'two\nlines', 'a message may span lines');
  assert.equal(bodyOf('[@vue/compiler-sfc] no frame here', 'F.obix'), 'no frame here');
  assert.equal(bodyOf('[@vue/compiler-sfc] trailing space \n\nF.obix\nframe', 'F.obix'), 'trailing space');
  assert.equal(bodyOf('[@vue/compiler-sfc] a\n\nF.obix\nb\n\nF.obix\nc', 'F.obix'), 'a\n\nF.obix\nb', 'the LAST file name starts the decoration');
  assert.equal(bodyOf('no prefix at all', 'F.obix'), 'no prefix at all');
  assert.equal(bodyOf('[@vue/compiler-sfc] mentions X.obix\n\nF.obix\nf', 'F.obix'), 'mentions X.obix', 'another file name in the message is the message');
  assert.equal(stripAnsi('\u001b[1m\u001b[33mA\u001b[0m\u001b[33m B\u001b[0m'), 'A B');
});

test('a position the canonical SFC states is copied frozen, exactly — and the diagnostics of every stage place themselves with the ONE shared function of the parser package', () => {
  const stated = { line: 3, column: 7, offset: 21, extra: 'ignored' };
  const copy = freezePosition(stated);
  assert.deepEqual({ ...copy }, { line: 3, column: 7, offset: 21 });
  assert.ok(Object.isFrozen(copy) && copy !== stated);
  // the place of a deferred diagnostic IS the canonical SFC's, and the place of a syntax error is what the shared function derives from Babel's offset
  const source = '<script lang="coffee">\na = 1\n</script>\n';
  const sfc = toObixSfc(parseObix(source, 'Where.obix'));
  const [d] = compileObixScript(sfc).diagnostics;
  assert.deepEqual([{ ...d.start }, { ...d.end }], [{ ...sfc.script.loc.start }, { ...sfc.script.loc.end }]);
});

test('the confined run records and restores: what console.warn was given (joined), the frames the official code-frame function produced, and — when the run throws — the exception, with everything restored', () => {
  const shared = createRequire(requireHere.resolve('@vue/compiler-sfc'))('@vue/shared');
  const frame = shared.generateCodeFrame;
  const warn = console.warn;
  const ok = runInstrumented(() => {
    console.warn('a', 'b', 3);
    shared.generateCodeFrame('xy\nz', 1, 3);
    console.warn('after');
    return 42;
  });
  assert.deepEqual(ok.outcome, { ok: true, value: 42 });
  assert.deepEqual(ok.warnings.map((w) => w.raw), ['a b 3', 'after']);
  assert.equal(ok.warnings[0].frame, undefined, 'no frame had been generated when the first warning was printed');
  assert.deepEqual({ ...ok.warnings[1].frame, text: undefined }, { source: 'xy\nz', start: 1, end: 3, text: undefined }, 'the frame of the latest call belongs to the warning');
  assert.equal(ok.warnings[1].frame.text, frame('xy\nz', 1, 3), 'the recorded text is what the official function produced');
  assert.deepEqual({ ...ok.lastFrame, text: undefined }, { source: 'xy\nz', start: 1, end: 3, text: undefined });
  const thrown = new Error('boom');
  const bad = runInstrumented(() => { throw thrown; });
  assert.deepEqual([bad.outcome.ok, bad.outcome.thrown], [false, thrown]);
  assert.equal(bad.lastFrame, undefined);
  const defaults = runInstrumented(() => shared.generateCodeFrame('abc'));
  assert.deepEqual({ start: defaults.lastFrame.start, end: defaults.lastFrame.end }, { start: 0, end: 3 }, 'the official defaults are recorded as they apply');
  assert.equal(console.warn, warn);
  assert.equal(shared.generateCodeFrame, frame);
  assert.equal(runInstrumented(() => process.env.NODE_ENV).outcome.value, 'production', 'the once-per-process hints are silent inside');
});

test('deferred diagnostics name the tag they are about — the setup tag says so — and point at the content of the block', () => {
  const block = (extra) => ({ src: './x.ts', lang: 'coffee', loc: { start: { line: 1, column: 3, offset: 2 }, end: { line: 1, column: 6, offset: 5 } }, ...extra });
  const plain = deferredDiagnostic('src', block({}), 'F.obix');
  assert.match(plain.message, /^<script src="\.\/x\.ts"> is valid/);
  const setup = deferredDiagnostic('src', block({ setup: true }), 'F.obix');
  assert.match(setup.message, /^<script setup src="\.\/x\.ts"> is valid/);
  assert.match(deferredDiagnostic('language', block({ setup: true }), 'F.obix').message, /^<script setup lang="coffee"> is valid/);
  assert.deepEqual([plain.start.offset, plain.end.offset, plain.severity, plain.filename], [2, 5, 'error', 'F.obix']);
  assert.equal(plain.upstream, undefined);
});

// ── misuse ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('misuse throws a TypeError that says what was wrong: anything but a canonical SFC, a script block that does not match the source, and options that are not options', () => {
  const range = { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } };
  const block = { type: 'script', content: '', attrs: {}, lang: null, src: null, loc: range, setup: false };
  const malformed = [
    undefined, null, 'x', 1, {}, { filename: 'a.obix' }, { filename: 'a.obix', source: 'x' }, { filename: 1, source: 'x', script: null, scriptSetup: null }, { filename: 'a.obix', source: 1, script: null, scriptSetup: null },
    { filename: 'a.obix', source: 'x', script: 'no', scriptSetup: null },
    { filename: 'a.obix', source: 'x', script: null, scriptSetup: 'no' },
    { filename: 'a.obix', source: 'x', script: { ...block, content: 1 }, scriptSetup: null },
    { filename: 'a.obix', source: 'x', script: { ...block, lang: 1 }, scriptSetup: null },
    { filename: 'a.obix', source: 'x', script: { ...block, src: false }, scriptSetup: null },
    { filename: 'a.obix', source: 'x', script: { ...block, loc: {} }, scriptSetup: null },
    { filename: 'a.obix', source: 'x', script: { ...block, loc: { start: range.start } }, scriptSetup: null },
  ];
  for (const bad of malformed) {
    assert.throws(() => compileObixScript(bad), (e) => e instanceof TypeError && /^compileObixScript expects /.test(e.message), JSON.stringify(bad));
    assert.throws(() => compileVueScript(bad, 'script', [], {}), (e) => e instanceof TypeError && /^compileObixScript expects /.test(e.message), `core: ${JSON.stringify(bad)}`);
  }
  const sfc = toObixSfc(parseObix('<script>export default {}</script>\n', 'A.obix'));
  const skewed = structuredClone(sfc);
  skewed.script.loc.start.offset += 1;
  assert.throws(() => compileObixScript(skewed), (e) => e instanceof TypeError && /does not match/.test(e.message));
  const foreign = { ...structuredClone(sfc), source: 'no script here' };
  assert.throws(() => compileObixScript(foreign), (e) => e instanceof TypeError && /does not match/.test(e.message));
  const gained = { ...structuredClone(sfc), source: '<script>export default {}</script>\n<script setup>const a = 1</script>\n' };
  assert.throws(() => compileObixScript(gained), (e) => e instanceof TypeError && /does not match/.test(e.message), 'a script block the SFC does not know of');
  for (const bad of [null, 'x', 1, [], { mode: 'x' }, { id: '' }, { id: 1 }, { id: null }, { id: 'a', inline: true }]) {
    assert.throws(() => compileObixScript(sfc, bad), (e) => e instanceof TypeError && /^compileObixScript expects (?:an options object|no option named|id to be)/.test(e.message), JSON.stringify(bad));
  }
  for (const good of [undefined, {}, { id: undefined }, { id: 'abc' }]) assert.doesNotThrow(() => compileObixScript(sfc, good), JSON.stringify(good));
  // the message says what was wrong and what was received
  const message = (input, options) => { try { compileObixScript(input, options); } catch (e) { return e.message; } return undefined; };
  assert.equal(message(null), 'compileObixScript expects a canonical SFC (the result of toObixSfc), received null');
  assert.equal(message([]), 'compileObixScript expects a canonical SFC (the result of toObixSfc), received an array');
  assert.equal(message('x'), 'compileObixScript expects a canonical SFC (the result of toObixSfc), received string');
  assert.equal(message(sfc, null), 'compileObixScript expects an options object, received null');
  assert.equal(message(sfc, []), 'compileObixScript expects an options object, received an array');
  assert.equal(message(sfc, 'x'), 'compileObixScript expects an options object, received string');
  assert.equal(message(sfc, { mode: 1 }), 'compileObixScript expects no option named "mode" (the only option is id)');
  assert.equal(message(sfc, { id: '' }), 'compileObixScript expects id to be a non-empty string, received an empty string');
  assert.equal(message(sfc, { id: 1 }), 'compileObixScript expects id to be a non-empty string, received number');
  assert.equal(message(sfc, { id: null }), 'compileObixScript expects id to be a non-empty string, received null');
  assert.equal(message({ ...sfc, script: { ...sfc.script, content: 1 } }), 'compileObixScript expects the script blocks of a canonical SFC to be blocks with content, lang, src and loc');
});

test('the artifact says which blocks it was made from: the ranges of the blocks in the file, and the language', () => {
  const source = '<template><p /></template>\n<script lang="ts">\nexport default { name: "R" }\n</script>\n';
  const { artifact } = STAGE(source, 'R.obix');
  assert.deepEqual([artifact.kind, artifact.lang], ['script', 'ts']);
  const start = source.indexOf('\nexport default');
  assert.deepEqual([pos(artifact.scriptRange.start), pos(artifact.scriptRange.end)], [positionAt(source, start), positionAt(source, source.indexOf('</script>'))]);
  assert.equal(artifact.setupRange, null);
});

test('positions use the official convention — 1-based line and column, 0-based offset — and a deferred diagnostic points at the content of the block it is about', () => {
  const source = '<script lang="TS">export default {}</script>\n';
  const r = STAGE(source, 'Place.obix');
  assert.equal(r.status, 'deferred');
  const [d] = r.diagnostics;
  assertDiagnosticShape(d, 'Place.obix', 'deferred');
  const start = source.indexOf('>') + 1;
  assert.deepEqual([d.start.line, d.start.column, d.start.offset], [1, start + 1, start]);
  assert.equal(d.end.offset, start + 'export default {}'.length);
  assertLocated(d, source, 'export default {}', 'deferred');
});
