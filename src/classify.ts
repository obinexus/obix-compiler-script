/**
 * Turns what the official script compiler reports into an OBIX code plus the upstream identity and the raw text that travel beside it.
 *
 * The official compiler reports in three ways: it THROWS a message it prefixed itself (`[@vue/compiler-sfc] …`, from `ctx.error`), it throws Babel's own syntax
 * error (a `SyntaxError` with a `reasonCode`, prefixed `[vue/compiler-sfc]`), or it PRINTS a warning. Anything else that is thrown is not a diagnostic of the
 * compiler but a failure of it. Nothing is guessed: what no table knows is the reserved `OBIX_SCRIPT_UNCLASSIFIED`, with its message and raw text intact.
 */
import type { ObixUpstreamEnum, ObixUpstreamError } from "obix-compiler-diagnostics";
import { OBIX_SCRIPT_CODES } from "./codes.js";
import type { ScriptMessageCode } from "./codes.js";
import { officialVersion } from "./official.js";

export interface Classified {
  readonly code: string;
  /** The OBIX message: the official one without its decoration, or — for a failure of the compiler itself — a stable sentence (the raw text is the `detail`). */
  readonly message: string;
  /** What the official compiler said; absent for a failure of the compiler itself. */
  readonly upstream?: ObixUpstreamError;
  /** The raw text: the exception, or what the compiler printed. */
  readonly detail: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const upstreamOf = (enumName: ObixUpstreamEnum | null, name: string | null, code: string | null): ObixUpstreamError =>
  Object.freeze({ package: "@vue/compiler-sfc", version: officialVersion, enum: enumName, name, code });

/** The exception `@babel/parser` throws (through the official compiler): it names its reason and its own error code. */
function babelError(value: unknown): { readonly reasonCode: string; readonly code: string } | undefined {
  if (!isRecord(value) || typeof value["reasonCode"] !== "string" || typeof value["code"] !== "string") return undefined;
  return { reasonCode: value["reasonCode"], code: value["code"] };
}

const codeOf = (body: string, vocabulary: readonly ScriptMessageCode[]): string => vocabulary.find((entry) => entry.pattern.test(body))?.code ?? OBIX_SCRIPT_CODES.unclassified;

/** `body` is the message without the official decoration (see `bodyOf`); the raw text is what was thrown. */
export function classifyFailure(thrown: unknown, body: string, vocabulary: readonly ScriptMessageCode[]): Classified {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  const babel = babelError(thrown);
  if (babel) return { code: OBIX_SCRIPT_CODES.syntaxInvalid, message: body, upstream: upstreamOf("BabelParserReasonCodes", babel.reasonCode, babel.code), detail: raw };
  if (thrown instanceof Error && raw.startsWith("[@vue/compiler-sfc] ")) return { code: codeOf(body, vocabulary), message: body, upstream: upstreamOf(null, null, null), detail: raw };
  return { code: OBIX_SCRIPT_CODES.compilerFailed, message: `The official Vue compiler (@vue/compiler-sfc ${officialVersion}) could not compile this script.`, detail: raw };
}

/** A warning the official compiler printed: `raw` is what it printed without colour, `body` the message without the decoration. */
export function classifyWarning(raw: string, body: string, vocabulary: readonly ScriptMessageCode[]): Classified {
  return { code: codeOf(body, vocabulary), message: body, upstream: upstreamOf(null, null, null), detail: raw };
}
