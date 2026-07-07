// Pure helpers for the case detail Wizard view (CaseWizard).
//
// A task's draft-email steps carry an emailTemplate whose {{tokens}} were
// interpolated at task-creation time by sopResolver. When the underlying data
// was missing, the resolver's TOKEN_PATTERN only substitutes well-formed
// [a-zA-Z0-9_.] tokens, so any malformed or catalog-unknown placeholder can
// survive into the resolved text. The wizard surfaces those remaining
// {{token}} markers as gaps the user must fill before sending.
import type { Task } from "@/types";

// Matches a single {{ ... }} placeholder. Non-greedy inner match with no braces
// so adjacent placeholders never merge into one span.
const TOKEN_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

function freshPattern(): RegExp {
  return new RegExp(TOKEN_PATTERN.source, "g");
}

/**
 * Unresolved {{token}} names remaining in a piece of resolved text, de-duped in
 * first-seen order. Braces and surrounding whitespace are stripped; blank
 * placeholders ({{ }}) are ignored.
 */
export function findUnresolvedTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const re = freshPattern();
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export interface TextSegment {
  value: string;
  isToken: boolean;
}

/**
 * Splits text into alternating plain / {{token}} segments so the wizard can
 * highlight the placeholders in place. Token segments keep their raw braced
 * form as `value`.
 */
export function splitOnUnresolvedTokens(text: string): TextSegment[] {
  const re = freshPattern();
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ value: text.slice(lastIndex, m.index), isToken: false });
    }
    segments.push({ value: m[0], isToken: true });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ value: text.slice(lastIndex), isToken: false });
  }
  return segments;
}

/**
 * The step the wizard should open on: the first task that is not yet completed.
 * Returns 0 for an empty list or when every task is already completed.
 */
export function firstIncompleteTaskIndex(tasks: Pick<Task, "status">[]): number {
  const idx = tasks.findIndex((t) => t.status !== "completed");
  return idx === -1 ? 0 : idx;
}
