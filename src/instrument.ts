/**
 * Runs the official script compiler in a confined, deterministic environment, and hands back what it says outside its return value.
 *
 * The official `compileScript` reports in ways an API cannot reach: a warning is PRINTED (`console.warn`, with colour codes), an error is THROWN with its place
 * only inside a text code frame, and a few hints are printed once per process — unless `NODE_ENV` is `production`. A frontend must not print, must not depend on
 * what was compiled before it, and must say where a diagnostic points, so for the duration of one SYNCHRONOUS call three things are changed and restored:
 *
 *   - `console.warn` records instead of printing;
 *   - `NODE_ENV` is `production`, which makes the once-per-process hints silent — so a compile never depends on what came before it;
 *   - `@vue/shared`'s `generateCodeFrame` — the one function through which the official compiler turns a node's range into a frame — also records its arguments,
 *     which are the EXACT start and end offsets of the node. Reading them is exact where parsing the frame's text would not be (the official frame attributes a
 *     range that starts at the first column of a line to the end of the previous line).
 *
 * All three are restored in a `finally`. The call is synchronous, so nothing else runs while they are changed. Nothing is fabricated: a frame is trusted only if
 * the text it produced is what ends the message it belongs to (see compile.ts), and where the official compiler exposes nothing the diagnostic has no place.
 */
import { createRequire } from "node:module";
import { officialLocation } from "./official.js";

/** A call of the official `generateCodeFrame`: the source it was given, the range, and the text it produced. */
export interface Frame {
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface CapturedWarning {
  /** What was printed, colour codes and all. */
  readonly raw: string;
  /** The code frame the official compiler generated for it, when it did. */
  readonly frame: Frame | undefined;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly thrown: unknown };

export interface InstrumentedRun<T> {
  readonly outcome: Outcome<T>;
  readonly warnings: readonly CapturedWarning[];
  /** The frame of the failure, when the exception carries one. */
  readonly lastFrame: Frame | undefined;
}

interface SharedModule {
  generateCodeFrame(source: string, start?: number, end?: number): string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isSharedModule = (value: unknown): value is SharedModule => isRecord(value) && typeof value["generateCodeFrame"] === "function";

/** The `@vue/shared` the official compiler itself uses — resolved from where IT lives — or `undefined` when it cannot be reached and written to. */
function officialShared(): SharedModule | undefined {
  try {
    const shared: unknown = createRequire(officialLocation())("@vue/shared");
    if (!isSharedModule(shared)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(shared, "generateCodeFrame");
    return descriptor && (descriptor.writable || descriptor.set) ? shared : undefined;
  } catch {
    return undefined;
  }
}

/** Colour codes, as the official compiler wraps its warnings in them. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
export const stripAnsi = (text: string): string => text.replace(ANSI, "");

export function runInstrumented<T>(run: () => T): InstrumentedRun<T> {
  const shared = officialShared();
  const frames: Frame[] = [];
  const warnings: CapturedWarning[] = [];
  const originalFrame = shared ? shared.generateCodeFrame : undefined;
  const originalWarn = console.warn;
  const hadEnv = Object.hasOwn(process.env, "NODE_ENV");
  const originalEnv = process.env["NODE_ENV"];

  if (shared && originalFrame) {
    shared.generateCodeFrame = (source: string, start?: number, end?: number): string => {
      const text = originalFrame(source, start, end);
      frames.push({ source, start: start ?? 0, end: end ?? source.length, text });
      return text;
    };
  }
  console.warn = (...args: unknown[]): void => {
    warnings.push({ raw: args.map(String).join(" "), frame: frames.at(-1) });
  };
  process.env["NODE_ENV"] = "production";
  try {
    return { outcome: { ok: true, value: run() }, warnings, lastFrame: frames.at(-1) };
  } catch (thrown) {
    return { outcome: { ok: false, thrown }, warnings, lastFrame: frames.at(-1) };
  } finally {
    if (shared && originalFrame) shared.generateCodeFrame = originalFrame;
    console.warn = originalWarn;
    if (hadEnv) process.env["NODE_ENV"] = originalEnv;
    else delete process.env["NODE_ENV"];
  }
}
