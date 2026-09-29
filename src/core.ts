/**
 * The script frontend core: the script blocks of a canonical SFC, compiled by the OFFICIAL Vue script compiler.
 *
 *     ObixSfc ──► official descriptor ──► compileScript (confined, instrumented) ──► VueScriptArtifact + OBIX diagnostics
 *
 * Nothing here reimplements Vue: no script grammar, no macro handling, no binding analysis. What this module adds is what a frontend must decide around the
 * official compiler — the options (explicit), the diagnostics (OBIX-owned codes, upstream identity, file-absolute places), totality (the official compiler throws
 * on an error; that is a result, never an exception), and the capabilities it does not have yet (reported as deferred, not as invalid).
 *
 * Two entry points sit on it: `compileObixScript` (a normal `<script>`, obix-compiler-script) and `compileObixScriptSetup` (a `<script setup>`
 * with any normal `<script>` it is merged with, obix-compiler-script-setup). They differ in which blocks they own and in the vocabulary of the
 * messages they can meet; everything else is here.
 */
import { createHash } from "node:crypto";
import type { BindingMetadata, SFCScriptBlock } from "@vue/compiler-sfc";
import type { ObixCompilerDiagnostic } from "obix-compiler-diagnostics";
import type { ObixSfc } from "obix-compiler-sfc";
import { OBIX_SCRIPT_MESSAGE_CODES } from "./codes.js";
import type { ScriptMessageCode } from "./codes.js";
import { officialDescriptor } from "./descriptor.js";
import { deferredDiagnostic, failureDiagnostic, warningDiagnostic } from "./diagnostics.js";
import { assertCanonicalSfc, readOptions } from "./input.js";
import { runInstrumented } from "./instrument.js";
import { officialCompiler } from "./official.js";
import { resolveImports } from "./primitives.js";
import type { ObixScriptOptions, ObixScriptResult, ObixScriptStatus, ScriptKind, VueScriptArtifact, VueScriptImport } from "./types.js";

/** The name of the public function of each kind, for the messages of misuse. */
const ENTRY: Readonly<Record<ScriptKind, string>> = Object.freeze({ script: "compileObixScript", "script-setup": "compileObixScriptSetup" });

/** The languages the official script compiler compiles (`lang` js, jsx, ts, tsx, or none). Any other explicit `lang` it returns untouched: a preprocessor's job. */
const COMPILED_LANGS: readonly string[] = ["js", "jsx", "ts", "tsx"];

/**
 * Explicit, so that the output never depends on what the official defaults happen to be: development output (no hashed CSS variables), the template compiled
 * separately (the render function is the template stage's, not inlined into `setup()`), no source map, static hoisting, and reactive props destructure as in Vue 3.5.
 */
const OFFICIAL_OPTIONS = { isProd: false, inlineTemplate: false, sourceMap: false, hoistStatic: true, propsDestructure: true } as const;

/** The id of a component when the caller gives none: the first 8 hex digits of the SHA-256 of the file name (Vue's own rule, without the path). */
export const scriptIdOf = (filename: string): string => createHash("sha256").update(filename).digest("hex").slice(0, 8);

/** `ok`: this stage succeeded — it compiled (a compiled script has warnings at most: an error is a `failed` result) or had nothing to compile. */
function finish(filename: string, status: ObixScriptStatus, artifact: VueScriptArtifact | null, diagnostics: readonly ObixCompilerDiagnostic[]): ObixScriptResult {
  const ok = status === "absent" || status === "compiled";
  return Object.freeze({ filename, status, ok, artifact, diagnostics: Object.freeze([...diagnostics]) });
}

/** A frozen plain-data copy of the binding metadata: another stage is handed it, and the official compiler's own object stays out of reach. */
function frozenBindings(bindings: BindingMetadata | undefined): BindingMetadata {
  const copy: BindingMetadata = bindings === undefined ? {} : structuredClone(bindings);
  if (copy.__propsAliases) Object.freeze(copy.__propsAliases);
  return Object.freeze(copy);
}

function frozenImports(imports: SFCScriptBlock["imports"]): readonly VueScriptImport[] {
  return Object.freeze(
    Object.entries(imports ?? {}).map(([local, i]) =>
      Object.freeze({ local, imported: i.imported, source: i.source, isType: i.isType, isFromSetup: i.isFromSetup, isUsedInTemplate: i.isUsedInTemplate }),
    ),
  );
}

/**
 * Compile the script blocks a stage owns. `vocabulary` is the table of the messages that only this kind can produce; the shared table (codes.ts) is always
 * appended. Never throws for a script, however invalid; throws a `TypeError` only for misuse (input that is not a canonical SFC, a canonical SFC that does not
 * match its own source, options that are not `ObixScriptOptions`).
 */
export function compileVueScript(sfc: ObixSfc, kind: ScriptKind, vocabulary: readonly ScriptMessageCode[], options?: ObixScriptOptions): ObixScriptResult {
  const entry = ENTRY[kind];
  assertCanonicalSfc(sfc, entry);
  const { id = scriptIdOf(sfc.filename) } = readOptions(options, entry);
  const { filename, source } = sfc;
  const descriptor = officialDescriptor(sfc, entry);
  const { script, scriptSetup } = descriptor;

  // a stage owns a `<script setup>` (with any normal script it is merged with), or a normal `<script>` alone; the other has nothing to compile
  const owned = kind === "script-setup" ? scriptSetup !== null : script !== null && scriptSetup === null;
  if (!owned) return finish(filename, "absent", null, []);

  // The official order: a language mismatch is thrown before anything else — so it is reported even where a block would otherwise be deferred.
  const blocks = [script, scriptSetup].flatMap((block) => (block === null ? [] : [block]));
  if (!(script !== null && scriptSetup !== null && script.lang !== scriptSetup.lang)) {
    const withSrc = blocks.find((block) => block.src);
    if (withSrc) return finish(filename, "deferred", null, [deferredDiagnostic("src", withSrc, filename)]);
    const withLanguage = blocks.find((block) => block.lang && !COMPILED_LANGS.includes(block.lang));
    if (withLanguage) return finish(filename, "deferred", null, [deferredDiagnostic("language", withLanguage, filename)]);
  }

  const table = [...vocabulary, ...OBIX_SCRIPT_MESSAGE_CODES];
  const run = runInstrumented(() => officialCompiler().compileScript(descriptor, { id, ...OFFICIAL_OPTIONS }));
  const reported = run.warnings.map((warning) => warningDiagnostic(warning, filename, source, table));
  if (!run.outcome.ok) {
    // What the official compiler reported before it gave up is kept, and the failure is last.
    reported.push(failureDiagnostic(run.outcome.thrown, run.lastFrame, filename, source, table));
    return finish(filename, "failed", null, reported);
  }
  const compiled = run.outcome.value;
  const artifact: VueScriptArtifact = Object.freeze({
    kind,
    lang: (scriptSetup ?? script)?.lang ?? null,
    scriptRange: sfc.script === null ? null : sfc.script.loc,
    setupRange: sfc.scriptSetup === null ? null : sfc.scriptSetup.loc,
    content: compiled.content,
    bindings: frozenBindings(compiled.bindings),
    imports: frozenImports(compiled.imports),
    // OBIX's resolution of the imports, beside the official compiler's record of them — the blocks in the order of the file
    resolutions: resolveImports(sfc.script !== null && sfc.scriptSetup !== null && sfc.scriptSetup.loc.start.offset < sfc.script.loc.start.offset ? [compiled.scriptSetupAst, compiled.scriptAst] : [compiled.scriptAst, compiled.scriptSetupAst]),
    scriptAst: compiled.scriptAst,
    scriptSetupAst: compiled.scriptSetupAst,
  });
  return finish(filename, "compiled", artifact, reported);
}
