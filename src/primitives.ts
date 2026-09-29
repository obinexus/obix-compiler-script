/**
 * OBIX authoring primitives — resolved at the Vue frontend's import boundary (C1, docs/recovery/vuets-compiler.md §22).
 *
 * OBIX components are authored with `import { ref, computed } from "obix"`. The official Vue compiler cannot see that module (it keeps the source as written, and
 * its binding kinds say `setup-maybe-ref`); the FRONTEND resolves it, here, through an explicit registry: each entry names the Vue primitive an authoring name is
 * proven equivalent to (tests/vuets/obix-primitives.test.mjs runs it on Vue's real runtime and on the IR). The result is normalized metadata beside the official
 * compiler's — `artifact.resolutions` — which the later stages read instead of module names: nothing downstream compares a specifier with "obix" or with "vue".
 *
 * Never a blanket rule: a name "obix" exports that the registry does not list is `unregistered-authoring`, even when Vue exports a function of that name. Never a
 * rewrite: the source, the compiled script and the imports as written stay exactly as they were. An entry is added only with its own proof.
 */
import type { VueImportResolution, VuePrimitive } from "./types.js";

/** The authoring module of OBIX, as authors write it. */
const AUTHORING_MODULE = "obix";

/** The module whose primitives the Vue frontend lowers. */
const VUE_MODULE = "vue";

const primitive = (name: string): VuePrimitive => Object.freeze({ module: VUE_MODULE, export: name });

/**
 * The registry: an authoring name → the Vue primitive it is proven to mean. `ref` and `computed` (C1), `watch` (D-104: the same IR as `watch` from "vue", and the
 * same frames on real Vue, the IR's evaluator and the native runtime — tests/runtime/obix-watch.test.mjs; a form the IR does not represent defers exactly as it
 * does from "vue") — nothing else until another entry has its proof.
 */
export const OBIX_AUTHORING_PRIMITIVES: Readonly<Record<string, VuePrimitive>> = Object.freeze({
  computed: primitive("computed"),
  ref: primitive("ref"),
  watch: primitive("watch"),
});

/** The part of a Babel import declaration the resolution reads. */
interface ImportNode {
  readonly type: string;
  readonly importKind?: string | null;
  readonly source?: { readonly value?: unknown };
  readonly specifiers?: readonly {
    readonly type: string;
    readonly importKind?: string | null;
    readonly local?: { readonly name?: unknown };
    readonly imported?: { readonly type: string; readonly name?: unknown; readonly value?: unknown };
  }[];
}

/** What one import binds to, for the later stages. */
function resolveOne(source: string, imported: string, isType: boolean): VueImportResolution["primitive"] {
  if (isType) return null;
  if (source === VUE_MODULE) return imported === "default" || imported === "*" ? null : primitive(imported);
  if (source === AUTHORING_MODULE) return Object.hasOwn(OBIX_AUTHORING_PRIMITIVES, imported) ? (OBIX_AUTHORING_PRIMITIVES[imported] as VuePrimitive) : "unregistered-authoring";
  return null;
}

/** The resolution of every binding the script blocks import, in the order of the blocks in the file and of the imports in each. */
export function resolveImports(blocks: readonly (readonly unknown[] | undefined)[]): readonly VueImportResolution[] {
  const out: VueImportResolution[] = [];
  for (const statements of blocks) {
    for (const statement of statements ?? []) {
      const node = statement as ImportNode;
      if (node.type !== "ImportDeclaration") continue;
      const source = String(node.source?.value);
      for (const item of node.specifiers ?? []) {
        const local = String(item.local?.name);
        const imported =
          item.type === "ImportDefaultSpecifier" ? "default" : item.type === "ImportNamespaceSpecifier" ? "*" : String(item.imported?.type === "StringLiteral" ? item.imported.value : item.imported?.name);
        const isType = node.importKind === "type" || item.importKind === "type";
        out.push(Object.freeze({ local, source, imported, primitive: resolveOne(source, imported, isType) }));
      }
    }
  }
  return Object.freeze(out);
}
