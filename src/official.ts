/**
 * The one place that loads the official Vue script compiler — and it does so on FIRST USE, not at import.
 *
 * Why: the official `@vue/compiler-sfc` bundles a lodash that probes a browser global while it loads (`typeof self` at module initialisation). That is harmless in
 * Node, but importing an OBIX compiler package must read no browser global at all (directive, Bottleneck C: compile-time, server-runtime and browser-runtime are
 * distinct, and a server-safe module must import in Node without `window`, `document` or `self`). Loading on the first compile keeps the import pure;
 * `npm run check:purity` enforces the import, the package's tests enforce the first use.
 *
 * What is read without executing any of the compiler's code: its version, from its package.json.
 */
import { createRequire } from "node:module";
import type * as Sfc from "@vue/compiler-sfc";

export interface OfficialScriptCompiler {
  readonly parse: typeof Sfc.parse;
  readonly compileScript: typeof Sfc.compileScript;
}

const requireOfficial = createRequire(import.meta.url);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isSfcModule(value: unknown): value is Pick<typeof Sfc, "parse" | "compileScript"> {
  return isRecord(value) && typeof value["parse"] === "function" && typeof value["compileScript"] === "function";
}

/** The version of the official compiler, read from its package.json (which executes none of its code). */
function readVersion(): string {
  const manifest: unknown = requireOfficial("@vue/compiler-sfc/package.json");
  if (!isRecord(manifest) || typeof manifest["version"] !== "string") throw new Error("@vue/compiler-sfc/package.json has no version");
  return manifest["version"];
}

export const officialVersion: string = readVersion();

let loaded: OfficialScriptCompiler | undefined;

/** Loads `@vue/compiler-sfc` the first time it is called; the same frozen object afterwards. */
export function officialCompiler(): OfficialScriptCompiler {
  if (loaded) return loaded;
  const sfc: unknown = requireOfficial("@vue/compiler-sfc");
  if (!isSfcModule(sfc)) throw new Error("@vue/compiler-sfc does not export parse and compileScript");
  loaded = Object.freeze({ parse: sfc.parse, compileScript: sfc.compileScript });
  return loaded;
}

/** The location of the official compiler on disk, so that the modules IT loads (`@vue/shared`) are resolved from where it lives and not from here. */
export function officialLocation(): string {
  return requireOfficial.resolve("@vue/compiler-sfc");
}
