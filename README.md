# obix-compiler-script

> Previous name: `@obinexusltd/obix-compiler-script` — OBIX packages are named without an npm scope since decision D-102 (2026-09-29); the package, its version and its exports are unchanged.

**The Vue script frontend of the `.obix` compiler — the normal `<script>` of a canonical SFC (JavaScript or `lang="ts"`), compiled by the official Vue script compiler.**

`.obix` source is Vue-compatible single-file-component source, so its script is a Vue script, and the compiler of Vue scripts is the official one, `@vue/compiler-sfc` (`compileScript`), pinned at exactly **3.5.43** by `obix-vue.json` (OBIX monorepo record). There is no OBIX script grammar here, no second parser, no macro handling, no regular expression over the source and no copy of Vue code.

```text
Counter.obix ─► parseObix ─► toObixSfc ─► compileObixScript ─► VueScriptArtifact   (+ OBIX diagnostics)
                (parser)      (sfc)        (the official compileScript)
```

```bash
npm install obix-compiler-script
```

```ts
import { parseObix } from "obix-compiler-parser";
import { toObixSfc } from "obix-compiler-sfc";
import { compileObixScript } from "obix-compiler-script";

const result = compileObixScript(toObixSfc(parseObix(source, "Options.obix")));
result.status;                 // "compiled" | "failed" | "absent" | "deferred"
result.ok;                     // this stage succeeded: no error diagnostic, or nothing to compile
result.artifact?.content;      // the compiled module, as the official compiler generates it (TypeScript retained)
result.artifact?.bindings;     // Vue's binding metadata — frozen plain data — for the template stage
result.artifact?.imports;      // every import, with its source exactly as written (`"obix"` stays `"obix"`)
result.diagnostics;            // frozen; { code, message, severity, filename, start, end, upstream?, detail? }
```

This package compiles a **normal `<script>`**. A file with a `<script setup>` — alone or with a normal `<script>` — is [`obix-compiler-script-setup`](https://github.com/obinexus/obix-compiler-script-setup)'s: the official compiler compiles the two together, so for such a file (and for one with no script) this stage has nothing to compile: `absent`. Both sit on the same core, `compileVueScript`, which is exported for the setup stage.

| Export | Role |
|---|---|
| `compileObixScript(sfc, options?)` | compile the normal `<script>` of a canonical SFC; throws `TypeError` only for misuse (not a canonical SFC, script blocks that do not match the SFC's source, options that are not `ObixScriptOptions`) |
| `compileVueScript(sfc, kind, vocabulary, options?)` | the shared core: `kind` is `"script"` or `"script-setup"`, `vocabulary` the table of the messages only that kind can produce |
| `scriptIdOf(filename)` | the id a component gets when the caller gives none: the first 8 hex digits of the SHA-256 of the file name |
| `scriptCompilerVersion` | the version of the official compiler wrapped (asserted to be 3.5.43) |
| `OBIX_SCRIPT_CODES` · `OBIX_SCRIPT_MESSAGE_CODES` | the OBIX codes of the script stages, and the table of the messages any script can produce |
| types | `ObixScriptResult`, `ObixScriptStatus`, `ObixScriptOptions`, `ScriptKind`, `VueScriptArtifact`, `VueScriptImport`, `ScriptMessageCode` |

## The result

| `status` | Means | `artifact` | `ok` |
|---|---|---|---|
| `compiled` | the official compiler produced an artifact (there may still be **warning** diagnostics) | yes | no error diagnostic |
| `failed` | the official compiler reported an error or threw; the warnings it printed before are kept, the failure is last | no | no |
| `absent` | this stage has nothing to compile: no `<script>`, or a `<script setup>` is present (the setup stage's) | no | yes |
| `deferred` | valid Vue-compatible syntax this frontend does not compile **yet**: `<script src="…">`, or a `lang` the official compiler does not compile | no | no |

A bad script is never an exception, and **nothing is printed**. **`deferred` is not "invalid"**: `<script src>` and `lang="coffee"` are valid Vue-compatible syntax; resolving an external file and running a preprocessor are capabilities this frontend does not have yet. The diagnostic says exactly that (`OBIX_SCRIPT_DEFERRED_EXTERNAL_SRC`, `OBIX_SCRIPT_DEFERRED_LANGUAGE`) and points at the content of the block. The official compiler compiles `js`, `jsx`, `ts` and `tsx` (and no `lang`, and an empty one); it hands any other block back untouched — the tests state that as a fact.

**Total and composable.** The stage is not refused because the SFC parser reported recoverable errors. It reports its own diagnostics only; the SFC keeps its parse diagnostics, and the orchestrator that aggregates the stages decides whether to emit.

### The artifact is a frontend artifact

`VueScriptArtifact` = `{ kind, lang, scriptRange, setupRange, content, bindings, imports, scriptAst, scriptSetupAst }`. It is **not** OBIX semantics — the canonical DOP IR is (D-44), a later phase lowers this artifact into it, and nothing here defines that IR.

* **`content`** is the module the official compiler generates. **TypeScript syntax is retained**: removing it is [`obix-compiler-typescript`](https://github.com/obinexus/obix-compiler-typescript), not emit. Its own helpers are imported from `"vue"` (which runtime owns them is a later phase); the user's imports — `from "obix"` included — are **left exactly as written**.
* **`bindings`** is Vue's binding metadata (`setup-ref`, `props`, `data`, `options`, …): a frozen plain-data copy, handed to the template stage as `compileObixTemplate(sfc, { bindingMetadata })`. The official analysis of a normal script reads only an object literal (`export default { props, data, methods }`, `setup()`'s returned object): `defineComponent({…})` gives `{}`, exactly as for Vue's own tooling.
* **`scriptAst`** / **`scriptSetupAst`** are the official Babel ASTs of the blocks — the official compiler's own objects, not frozen; their positions are relative to the content of their block (add the block range's start offset for a file offset). The official compiler hangs private working objects (`_ownerScope`) on some nodes.

## Diagnostics

Each diagnostic is an `ObixCompilerDiagnostic` (the type of `obix-compiler-diagnostics`, the frontend-neutral contract) with the official message — without Vue's prefix and without the file name and code frame that follow it — and:

* **an OBIX-owned `code`**: words only, never a Vue or Babel number. The official compiler states no code for what it reports, so the vocabulary is a table from the **exact message** to the code, checked for completeness against the source of the pinned compiler (a Vue upgrade that adds or rewords a message fails the tests until it is decided again). `OBIX_SCRIPT_SYNTAX_INVALID` (one code for every Babel syntax error), `OBIX_SCRIPT_LANG_MISMATCH`, `OBIX_SCRIPT_COMPILER_FAILED` (an exception from inside the compiler), the reserved `OBIX_SCRIPT_UNCLASSIFIED`, and the two deferred capabilities. The macro and setup messages are [`script-setup`](https://github.com/obinexus/obix-compiler-script-setup)'s.
* **`upstream`** — what Vue said, as metadata: `{ package: "@vue/compiler-sfc", version, enum, name, code }`; for a Babel syntax error `enum: "BabelParserReasonCodes"`, `name` its reason code and `code: "BABEL_PARSER_SYNTAX_ERROR"`; `null`s where the official compiler states nothing.
* **`detail`** — the raw text of the exception (or of what the compiler printed, without colour), code frame included.
* **a file-absolute place** (`start` / `end`, 1-based `line` and `column`, 0-based `offset`) where the official compiler gives one — see below.

## How the official compiler is confined

`compileScript` reports in ways an API cannot reach: a warning is **printed**, an error is **thrown** with its place only inside a text code frame, and a few hints are printed **once per process**. A frontend must not print, must not depend on what was compiled before it, and must say where a diagnostic points. So for the duration of one **synchronous** call three things are changed and restored in a `finally`:

1. `console.warn` records instead of printing;
2. `NODE_ENV` is `production`, which silences the once-per-process hints (they are not part of a result: a compile never depends on what came before it);
3. `@vue/shared`'s `generateCodeFrame` — the one function through which the official compiler turns a node's range into a frame — also records its arguments, which are the **exact offsets** of the node. (Parsing the frame's text would be inexact: the official frame attributes a range that starts at the first column of a line to the end of the previous line.)

A frame is trusted only if it is one of this file's and the text it produced is exactly what ends the report; otherwise the diagnostic has no place, and none is made up. The tests check that all three are restored — after a success and after a failure — and that a compile under `NODE_ENV=development` and `production` gives the same result.

## Options

`compileObixScript(sfc, { id })` — the options object is closed: an unknown option is a `TypeError`. The **`id`** scopes the CSS variables `v-bind()` in `<style>` injects; when it is left out it is a stable function of the file name (`scriptIdOf`), so the output never depends on where a file lies or on the order of compilation. The options given to `compileScript` are explicit, never Vue's defaults: development output, no inlined template (the render function is the template stage's), no source map, static hoisting, reactive props destructure.

## What this package does not do

* It does not remove TypeScript (the TypeScript phase), resolve `from "obix"` (the alias phase), resolve `<script src>` or run a script preprocessor (deferred), resolve a type imported from another file for a macro (that needs a file-system host: a deferred capability, reported as the official error), or compose source maps (deferred).
* It does not compile a template (the template stage), and does not define OBIX semantics, the DOP IR, or a second script AST.

The Level-0 compiler is a different track: [`obix-compiler-legacy-parser`](https://github.com/obinexus/obix-compiler-legacy-parser), frozen. Nothing here imports it.

## Dependency role

Depends on `@vue/compiler-sfc` (exactly 3.5.43 — listed in `obix-vue.json` with its phase and reason) and, for types, on `obix-compiler-sfc` and `obix-compiler-diagnostics` (which also supplies the one shared position function, `positionAt`); the parser is a test-time dependency. **The official compiler is loaded on the first compile, not at import**: its own initialisation probes a browser global (`self`), and importing an OBIX package must read none (`npm run check:purity`, and a test that imports this package with every browser global trapped). A compile-time package: it never belongs in a browser bundle (graph rule R5).

## Tests

`npm test -w obix-compiler-script` — every expectation is obtained from the **official** compiler (`tests/vuets/oracle.mjs`) and reduced to plain data before the code under test runs. Corpus: `tests/corpus/vuets` (OBIX monorepo record) — byte-identical `.vue` / `.obix` pairs.

<!-- obix-release:begin — generated by scripts/release/prepare.mjs; edit the text above this line -->

## Installation

```bash
npm install obix-compiler-script
```

> **Not yet on npm.** The OBIX packages are prepared for publication and are published only on the owner's authorisation; until then this is the command the published package will answer to.

## API surface

- `obix-compiler-script` — 7 value exports: `OBIX_AUTHORING_PRIMITIVES`, `OBIX_SCRIPT_CODES`, `OBIX_SCRIPT_MESSAGE_CODES`, `compileObixScript`, `compileVueScript`, `scriptCompilerVersion`, `scriptIdOf`
- Type declarations: `./dist/index.d.ts` (and a declaration next to every JS entry point).

## Architecture role

`obix-compiler-script` is part of the **OBIX compiler** (build-time tooling): it never runs in an application's browser graph.

The architecture of OBIX — the package families and which packages are public API — is indexed in the umbrella: [docs/architecture.md](https://github.com/obinexus/obix/blob/main/docs/architecture.md).

## Package relationships

- Depends on (OBIX): [`obix-compiler-diagnostics`](https://github.com/obinexus/obix-compiler-diagnostics), [`obix-compiler-sfc`](https://github.com/obinexus/obix-compiler-sfc).
- Used by (OBIX): [`obix-compiler-dop`](https://github.com/obinexus/obix-compiler-dop), [`obix-compiler-script-setup`](https://github.com/obinexus/obix-compiler-script-setup).
- Third-party: `@vue/compiler-sfc`.

## Testing

- No test file ships in the npm package: this package's tests use the monorepo's shared harness (listed below), so they are in the repository only.
- Run them with `npm test` (`node --test "test/*.test.mjs"`) in the OBIX monorepo, which provides the test tooling (Node's test runner, TypeScript).
- 3 test files are in the repository but not in the npm package, because they use the monorepo's shared test harness, oracles or fixtures:
  - `test/env-probe.mjs` — reads ../../../tests/vuets/oracle.mjs, outside the package
  - `test/primitives.test.mjs` — reads ../../obix-compiler-script-setup/dist/index.js, outside the package
  - `test/script.test.mjs` — reads ../../../tests/vuets/oracle.mjs, outside the package

## Documentation

- [CHANGELOG.md](CHANGELOG.md)
- The OBIX architecture index: [obix/docs/architecture.md](https://github.com/obinexus/obix/blob/main/docs/architecture.md)

## Repository

- https://github.com/obinexus/obix-compiler-script — `git@github.com:obinexus/obix-compiler-script.git`
- Issues: https://github.com/obinexus/obix-compiler-script/issues
- The repository is a clean export of the package from the OBIX monorepo; its lineage (the monorepo commit it was exported from, the sources it was recovered from, earlier names) is in `PROVENANCE.json`.

## License

MIT — see [LICENSE](LICENSE).

<!-- obix-release:end -->
