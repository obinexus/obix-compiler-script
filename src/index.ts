/**
 * obix-compiler-script — the Vue script frontend of the `.obix` compiler (Phase 3 of the VueTS compiler recovery, docs/recovery/vuets-compiler.md).
 *
 * `.obix` source is Vue-compatible SFC source, so its script is a Vue script, and the compiler of Vue scripts is the official one, `@vue/compiler-sfc`
 * (`compileScript`, pinned at exactly 3.5.43 by obix-vue.json). There is no OBIX script grammar here, no second parser, no macro handling and no copy of Vue code:
 *
 *     ObixSfc (canonical) ──► the official script compiler ──► VueScriptArtifact  (+ OBIX diagnostics)
 *
 * The artifact is a FRONTEND artifact — Vue's compiled script module, the binding metadata the template stage needs, the imports and the Babel AST. It is not the
 * semantic authority of OBIX: the canonical DOP IR is (D-44), a later phase lowers the artifact into it, and this package defines none of it. TypeScript syntax
 * is retained (removing it is obix-compiler-typescript), and the `obix` authoring alias in an import is left exactly as written.
 *
 * This package compiles a normal `<script>`; obix-compiler-script-setup compiles a `<script setup>` on the same core (`compileVueScript`).
 * It is NOT the Level-0 compiler: that one is the frozen legacy track (D-46), and nothing here imports it.
 *
 * The official compiler is loaded on the FIRST COMPILE, not at import (see official.ts): importing this package reads no browser global.
 */
export { compileObixScript } from "./compile.js";
export { compileVueScript, scriptIdOf } from "./core.js";
export { OBIX_SCRIPT_CODES, OBIX_SCRIPT_MESSAGE_CODES } from "./codes.js";
export type { ScriptMessageCode } from "./codes.js";
export { officialVersion as scriptCompilerVersion } from "./official.js";
export { OBIX_AUTHORING_PRIMITIVES } from "./primitives.js";
export type { ObixScriptOptions, ObixScriptResult, ObixScriptStatus, ScriptKind, VueImportResolution, VuePrimitive, VueScriptArtifact, VueScriptImport } from "./types.js";
