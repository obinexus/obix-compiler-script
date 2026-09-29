/**
 * Positions the script stages state themselves. Positions in the FILE are the official convention — 1-based `line` and `column`, 0-based `offset` — and the function that
 * derives one from an offset is shared by every stage (`positionAt` of obix-compiler-diagnostics); what is here is only the copy of a position the canonical SFC
 * already states.
 */
import type { ObixSourcePosition, SourcePosition } from "obix-compiler-diagnostics";

/** A position the canonical SFC states, as a frozen OBIX position. */
export const freezePosition = (p: SourcePosition): ObixSourcePosition => Object.freeze({ line: p.line, column: p.column, offset: p.offset });
