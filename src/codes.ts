/**
 * The OBIX diagnostic vocabulary of the script stages.
 *
 * OBIX codes are OBIX-OWNED identifiers: words only, never a Vue or Babel number or name. The official script compiler states no code for what it reports — it
 * throws or prints a message — so the vocabulary is a table from the EXACT MESSAGE to an OBIX code, checked for completeness against the source of the pinned
 * compiler (a Vue upgrade that adds or rewords a message fails the tests until it is decided again). What the compiler said travels beside the code, as
 * `upstream` metadata and the raw text as `detail` (types of obix-compiler-diagnostics).
 *
 * This table holds what any script can produce. The messages that only a `<script setup>` produces — the compiler macros, the props destructure, type resolution —
 * are the vocabulary of obix-compiler-script-setup, which is given to the shared core beside this one.
 */

/** Codes that are OBIX's own, or that stand for a class of what the official compiler reports. */
export const OBIX_SCRIPT_CODES = Object.freeze({
  /** Babel could not parse the script. The identity of the syntax error (its reason code) is `upstream` metadata; there is one OBIX code for all of them. */
  syntaxInvalid: "OBIX_SCRIPT_SYNTAX_INVALID",
  /** `<script>` and `<script setup>` disagree on `lang`. */
  langMismatch: "OBIX_SCRIPT_LANG_MISMATCH",
  /** The official compiler failed from the inside: an exception that is not one of its diagnostics, or an invariant it asserts. */
  compilerFailed: "OBIX_SCRIPT_COMPILER_FAILED",
  /** Reserved: a message of the official compiler that no table knows (a message added or reworded by a newer Vue). The tests fail if the corpus produces one. */
  unclassified: "OBIX_SCRIPT_UNCLASSIFIED",
  /** `<script src="…">`: valid Vue-compatible syntax; resolving an external script file is a deferred capability. */
  deferredExternalSrc: "OBIX_SCRIPT_DEFERRED_EXTERNAL_SRC",
  /** `<script lang="coffee">` and the like: valid Vue-compatible syntax; the official compiler compiles only js, jsx, ts and tsx, and a preprocessor is a deferred capability. */
  deferredLanguage: "OBIX_SCRIPT_DEFERRED_LANGUAGE",
} as const);

export interface ScriptMessageCode {
  /** Matches the official message BODY: what `ctx.error` was given, without Vue's prefix and without the file name and code frame that follow it. */
  readonly pattern: RegExp;
  readonly code: string;
}

/** The messages of the official script compiler that do not belong to `<script setup>`; anchored, so a reworded message is unclassified rather than mis-classified. */
export const OBIX_SCRIPT_MESSAGE_CODES: readonly ScriptMessageCode[] = Object.freeze([
  Object.freeze({ pattern: /^<script> and <script setup> must have the same language type\.$/, code: OBIX_SCRIPT_CODES.langMismatch }),
  Object.freeze({ pattern: /^registerBinding called without active scope, something is wrong\.$/, code: OBIX_SCRIPT_CODES.compilerFailed }),
]);
