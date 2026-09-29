/**
 * `compileObixScript`: the normal `<script>` of a canonical SFC, compiled by the OFFICIAL Vue script compiler — JavaScript and `lang="ts"`.
 *
 * An SFC with a `<script setup>` is not this stage's: the official compiler compiles it together with its normal `<script>`, and that is
 * obix-compiler-script-setup. For such an SFC — and for one with no script — this stage has nothing to compile: `absent`.
 */
import type { ObixSfc } from "obix-compiler-sfc";
import { compileVueScript } from "./core.js";
import type { ObixScriptOptions, ObixScriptResult } from "./types.js";

/**
 * Compile the normal `<script>` of a canonical SFC (no `<script setup>`) with the official Vue script compiler.
 *
 * Never throws for a script, however invalid: what the compiler reports becomes diagnostics, and a compiler that gives up becomes a `failed` result. It throws a
 * `TypeError` only for misuse — something that is not a canonical SFC, an SFC whose script blocks do not match its own source, or options that are not
 * `ObixScriptOptions`.
 *
 * Total and composable: the stage is not refused because the SFC parser reported recoverable errors. Only THIS stage's diagnostics are reported; the SFC's parse
 * diagnostics stay on the SFC, and the orchestrator that aggregates them decides whether to emit.
 */
export function compileObixScript(sfc: ObixSfc, options?: ObixScriptOptions): ObixScriptResult {
  return compileVueScript(sfc, "script", [], options);
}
