/**
 * The public types of the Vue script frontends (Phase 3 of the VueTS compiler recovery, docs/recovery/vuets-compiler.md).
 *
 * `VueScriptArtifact` is a FRONTEND artifact: the official Vue script compiler's own output — the compiled module, the binding metadata, the imports and the Babel
 * AST of the source. It is not OBIX semantics: the canonical DOP IR will be (D-44), and a later phase lowers this artifact into it. Nothing here defines that IR.
 */
import type { BindingMetadata, SFCScriptBlock } from "@vue/compiler-sfc";
import type { ObixStageResult, ObixStageStatus, SourceRange } from "obix-compiler-diagnostics";

/**
 * The common stage status of the contract, read for this stage:
 * - `compiled`: the official compiler produced an artifact (there may still be warning diagnostics);
 * - `failed`: the official compiler reported an error or threw, so there is no artifact;
 * - `absent`: this stage has nothing to compile: the SFC has no script block of the kind this stage owns;
 * - `deferred`: valid Vue-compatible syntax that this frontend does not compile YET (`<script src>`, a script language the official compiler does not compile):
 *   a deferred capability, not invalid syntax.
 */
export type ObixScriptStatus = ObixStageStatus;

/** Which blocks a script stage owns: a normal `<script>` alone, or a `<script setup>` (compiled together with any normal `<script>` by the official compiler). */
export type ScriptKind = "script" | "script-setup";

/** One import of the compiled script, as the official compiler registered it. Every import of a `<script setup>` — and of a normal `<script>` merged with it. */
/** A primitive of Vue: what a binding means to the later stages. */
export interface VuePrimitive {
  readonly module: "vue";
  readonly export: string;
}

/** What one imported binding resolves to (C1). `source` is the module as written — the provenance; `primitive` is the frontend's resolution. */
export interface VueImportResolution {
  readonly local: string;
  readonly source: string;
  readonly imported: string;
  readonly primitive: VuePrimitive | "unregistered-authoring" | null;
}

export interface VueScriptImport {
  readonly local: string;
  /** The imported name (`default` for a default import, `*` for a namespace). */
  readonly imported: string;
  /** The specifier exactly as written: `"obix"` stays `"obix"` — resolving the authoring alias is a later phase. */
  readonly source: string;
  readonly isType: boolean;
  readonly isFromSetup: boolean;
  readonly isUsedInTemplate: boolean;
}

/**
 * What the official script compiler produced. The two Babel ASTs are the official compiler's own objects, not frozen — treat them as read-only; their positions
 * are relative to the CONTENT of their block (add `scriptRange.start.offset` / `setupRange.start.offset` for a file offset).
 */
export interface VueScriptArtifact {
  readonly kind: ScriptKind;
  /** The language the official compiler compiled: `ts`, `tsx`, `js`, `jsx`, or `null` for JavaScript with no `lang`. (An empty `lang` is `""`.) */
  readonly lang: string | null;
  /** Where the content of the normal `<script>` lies in the SFC, or `null` when there is none. */
  readonly scriptRange: SourceRange | null;
  /** Where the content of the `<script setup>` lies in the SFC, or `null` when there is none. */
  readonly setupRange: SourceRange | null;
  /**
   * The compiled script module, as the official compiler generates it. TypeScript syntax is RETAINED (removing it is the TypeScript phase); helpers are imported
   * from "vue" — which runtime owns them is a later phase; the user's own imports, `from "obix"` included, are untouched.
   */
  readonly content: string;
  /**
   * Vue's binding metadata for the template stage (`compileObixTemplate(sfc, { bindingMetadata })`): what each name the script declares is — `setup-ref`,
   * `props`, `data`, … Plain data, frozen; `{}` when the official analysis finds none.
   */
  readonly bindings: BindingMetadata;
  readonly imports: readonly VueScriptImport[];
  /**
   * OBIX's resolution of every imported binding (C1, primitives.ts) — normalized metadata BESIDE the official compiler's, which it does not change: the Vue
   * primitive a binding means, whether imported from "vue" or as a registered OBIX authoring primitive from "obix"; `unregistered-authoring` for any other name
   * from "obix"; `null` for anything else. The later stages read this, never a module name.
   */
  readonly resolutions: readonly VueImportResolution[];
  /** The official Babel AST of the normal `<script>`, when there is one. */
  readonly scriptAst: SFCScriptBlock["scriptAst"];
  /** The official Babel AST of the `<script setup>`, when there is one. */
  readonly scriptSetupAst: SFCScriptBlock["scriptSetupAst"];
}

/**
 * The result of a script stage: the contract's stage result with the script artifact. `ok` is true when the script compiled with no error diagnostic, or there is no
 * script of this kind to compile; `artifact` is non-null exactly when `status` is `compiled`; the diagnostics are this stage's own, frozen, in the order they were
 * reported (the SFC's own parse diagnostics stay on the SFC).
 */
export type ObixScriptResult = ObixStageResult<VueScriptArtifact>;

/** What the frontend can be told beyond the SFC. The options object is closed: an unknown option is a `TypeError`, never silently ignored. */
export interface ObixScriptOptions {
  /**
   * The id of the component: it scopes the CSS variables that `v-bind()` in `<style>` injects, so it must be unique per file and stable across builds. When it is
   * left out it is the first 8 hex digits of the SHA-256 of the file name.
   */
  readonly id?: string;
}
