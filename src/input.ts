/**
 * What the script stages require of their input, checked where it is read. A canonical SFC comes from `toObixSfc`, the options from the caller; anything else is
 * misuse and a `TypeError`. No cast is used: the shape of every value is checked before it is trusted.
 */
import type { ObixSfc } from "obix-compiler-sfc";
import type { ObixScriptOptions } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isPlainObject = (value: unknown): value is Record<string, unknown> => isRecord(value) && !Array.isArray(value);
const hasNumber = (value: unknown, key: string): boolean => isRecord(value) && typeof value[key] === "number";
const isPosition = (value: unknown): boolean => hasNumber(value, "line") && hasNumber(value, "column") && hasNumber(value, "offset");
const isRange = (value: unknown): boolean => isRecord(value) && isPosition(value["start"]) && isPosition(value["end"]);
const isStringOrNull = (value: unknown): boolean => value === null || typeof value === "string";

function describe(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : typeof value;
}

function isBlock(value: unknown): boolean {
  return isRecord(value) && typeof value["content"] === "string" && isStringOrNull(value["lang"]) && isStringOrNull(value["src"]) && isRange(value["loc"]);
}

/** `entry` is the name of the public function whose input this is, so that the message names what the caller called. */
export function assertCanonicalSfc(value: unknown, entry: string): asserts value is ObixSfc {
  if (!isRecord(value) || typeof value["filename"] !== "string" || typeof value["source"] !== "string" || !("script" in value) || !("scriptSetup" in value)) {
    throw new TypeError(`${entry} expects a canonical SFC (the result of toObixSfc), received ${describe(value)}`);
  }
  for (const block of [value["script"], value["scriptSetup"]]) {
    if (block !== null && !isBlock(block)) throw new TypeError(`${entry} expects the script blocks of a canonical SFC to be blocks with content, lang, src and loc`);
  }
}

/** The options of the script stages: closed, so a mistake is an error and never a silently ignored option. */
export function readOptions(options: unknown, entry: string): ObixScriptOptions {
  if (options === undefined) return {};
  if (!isPlainObject(options)) throw new TypeError(`${entry} expects an options object, received ${describe(options)}`);
  for (const name of Object.keys(options)) {
    if (name !== "id") throw new TypeError(`${entry} expects no option named "${name}" (the only option is id)`);
  }
  const id = options["id"];
  if (id === undefined) return {};
  if (typeof id !== "string" || id === "") throw new TypeError(`${entry} expects id to be a non-empty string, received ${typeof id === "string" ? "an empty string" : describe(id)}`);
  return { id };
}
