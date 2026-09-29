/**
 * The official descriptor of a canonical SFC: what `compileScript` takes.
 *
 * The canonical SFC deliberately does not carry Vue's descriptor (D-44: the Vue AST is not OBIX semantics), so the frontend parses the source again with the
 * OFFICIAL parser — the same call, with the same explicit options, that produced the canonical SFC — and checks that what it finds is what the canonical SFC
 * says. A canonical SFC whose blocks are not those of its source was not produced together with it: that is misuse, and a `TypeError`.
 *
 * `compileScript` only reads the descriptor. (The official parser caches its results; that is harmless here because the script compile does not change what it
 * is given, and because the template stage parses on its own and never touches a descriptor.)
 */
import type { SFCDescriptor } from "@vue/compiler-sfc";
import type { ObixSfc, SfcScriptBlock } from "obix-compiler-sfc";
import { officialCompiler } from "./official.js";

type OfficialBlock = SFCDescriptor["script"];

function sameBlock(canonical: SfcScriptBlock | null, official: OfficialBlock): boolean {
  if (canonical === null || official === null) return canonical === null && official === null;
  return canonical.loc.start.offset === official.loc.start.offset && canonical.loc.end.offset === official.loc.end.offset;
}

export function officialDescriptor(sfc: ObixSfc, entry: string): SFCDescriptor {
  const { descriptor } = officialCompiler().parse(sfc.source, {
    filename: sfc.filename,
    sourceMap: false,
    ignoreEmpty: true,
    pad: false,
    templateParseOptions: { comments: true },
  });
  if (!sameBlock(sfc.script, descriptor.script) || !sameBlock(sfc.scriptSetup, descriptor.scriptSetup)) {
    throw new TypeError(`${entry}: the script of the SFC does not match its source — the canonical SFC and its source were not produced together`);
  }
  return descriptor;
}
