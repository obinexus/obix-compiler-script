/**
 * The diagnostics of the script stages: what the official compiler reports, what this frontend itself decides to say, and how both are shaped.
 *
 * Every diagnostic is frozen and carries a code of the OBIX vocabulary (codes.ts). Those that come from the official compiler carry what it said as `upstream`
 * metadata, its raw text as `detail`, and — where the official compiler exposes it — the place they point at, FILE-ABSOLUTE (locate.ts).
 */
import type { SFCDescriptor } from "@vue/compiler-sfc";
import { positionAt } from "obix-compiler-diagnostics";
import type { ObixCompilerDiagnostic, ObixDiagnosticSeverity, ObixSourcePosition, ObixUpstreamError } from "obix-compiler-diagnostics";
import { classifyFailure, classifyWarning } from "./classify.js";
import type { Classified } from "./classify.js";
import { OBIX_SCRIPT_CODES } from "./codes.js";
import type { ScriptMessageCode } from "./codes.js";
import type { CapturedWarning, Frame } from "./instrument.js";
import { stripAnsi } from "./instrument.js";
import { freezePosition } from "./locate.js";

type OfficialBlock = NonNullable<SFCDescriptor["script"]>;

interface Placed {
  readonly start: ObixSourcePosition;
  readonly end: ObixSourcePosition;
}

function diagnostic(fields: {
  code: string;
  message: string;
  severity: ObixDiagnosticSeverity;
  filename: string;
  at?: Placed | undefined;
  upstream?: ObixUpstreamError | undefined;
  detail?: string | undefined;
}): ObixCompilerDiagnostic {
  const { code, message, severity, filename, at, upstream, detail } = fields;
  return Object.freeze({
    code,
    message,
    severity,
    filename,
    ...(at ? { start: at.start, end: at.end } : {}),
    ...(upstream ? { upstream } : {}),
    ...(detail !== undefined ? { detail } : {}),
  });
}

/** The message of an official report without Vue's decoration: the prefix, and the file name and code frame that follow the message. */
export function bodyOf(raw: string, filename: string): string {
  const withoutPrefix = raw.replace(/^\[@?vue\/compiler-sfc\] /, "");
  const at = withoutPrefix.lastIndexOf(`\n\n${filename}\n`);
  return (at === -1 ? withoutPrefix : withoutPrefix.slice(0, at)).trimEnd();
}

/**
 * Where a report points, from the code frame the official compiler generated for it. A frame is trusted only when it is one of THIS file's (the official compiler
 * also frames types it resolved from other files) and the text it produced is exactly what ends the report: otherwise the diagnostic has no place, and none is made up.
 */
function placeOf(frame: Frame | undefined, raw: string, source: string): Placed | undefined {
  if (!frame || frame.source !== source || frame.text === "" || !raw.endsWith(frame.text)) return undefined;
  return { start: positionAt(source, frame.start), end: positionAt(source, frame.end) };
}

function fromClassified(classified: Classified, severity: ObixDiagnosticSeverity, filename: string, at: Placed | undefined): ObixCompilerDiagnostic {
  return diagnostic({ code: classified.code, message: classified.message, severity, filename, at, upstream: classified.upstream, detail: classified.detail });
}

/** A warning the official compiler printed. */
export function warningDiagnostic(warning: CapturedWarning, filename: string, source: string, vocabulary: readonly ScriptMessageCode[]): ObixCompilerDiagnostic {
  const raw = stripAnsi(warning.raw).replace(/\n$/, "");
  return fromClassified(classifyWarning(raw, bodyOf(raw, filename), vocabulary), "warning", filename, placeOf(warning.frame, raw, source));
}

/** What the official compiler threw: an error of the SFC's own script, or a failure of the compiler. */
export function failureDiagnostic(thrown: unknown, frame: Frame | undefined, filename: string, source: string, vocabulary: readonly ScriptMessageCode[]): ObixCompilerDiagnostic {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  return fromClassified(classifyFailure(thrown, bodyOf(raw, filename), vocabulary), "error", filename, placeOf(frame, raw, source));
}

/**
 * Valid Vue-compatible syntax this frontend does not compile YET. It says so: it is a capability that is missing, not a mistake in the source. The diagnostic
 * points at the content of the block it is about — the canonical SFC does not carry the position of an attribute.
 */
export function deferredDiagnostic(kind: "src" | "language", block: OfficialBlock, filename: string): ObixCompilerDiagnostic {
  const at = { start: freezePosition(block.loc.start), end: freezePosition(block.loc.end) };
  const tag = block.setup ? "<script setup" : "<script";
  if (kind === "src") {
    return diagnostic({
      code: OBIX_SCRIPT_CODES.deferredExternalSrc,
      message: `${tag} src="${block.src}"> is valid Vue-compatible SFC syntax, but resolving an external script file is a deferred capability of the OBIX script frontend and is not implemented yet: the script was not compiled.`,
      severity: "error",
      filename,
      at,
    });
  }
  return diagnostic({
    code: OBIX_SCRIPT_CODES.deferredLanguage,
    message: `${tag} lang="${block.lang}"> is valid Vue-compatible SFC syntax, but script languages other than js, jsx, ts and tsx are a deferred capability of the OBIX script frontend and are not implemented yet: the script was not compiled. Only JavaScript and TypeScript (lang js, jsx, ts, tsx, or none) are compiled today.`,
    severity: "error",
    filename,
    at,
  });
}
