import { createHash } from "node:crypto";

/**
 * Deduplication utilities. The rule from the brief: never create more than
 * one task for the same underlying commitment — across Circleback formal
 * action items, transcript-derived commitments, existing DeanOS tasks, and
 * Todoist titles.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "it",
  "of", "on", "or", "our", "that", "the", "their", "them", "then", "this",
  "to", "up", "with", "your",
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/follow up:/g, "follow-up")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join(" ")
    .trim();
}

/** Token-set Jaccard similarity over normalized titles. 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return intersection / union;
}

export const DUPLICATE_THRESHOLD = 0.75;

export function isDuplicateTitle(a: string, b: string, threshold = DUPLICATE_THRESHOLD): boolean {
  if (normalizeTitle(a) === normalizeTitle(b)) return true;
  return titleSimilarity(a, b) >= threshold;
}

/**
 * Stable dedup key for a task extracted from a specific source record.
 * Replaying the same payload regenerates the same key, so the DB unique
 * constraint absorbs replays.
 */
export function taskDedupKey(sourceSystem: string, sourceRecordId: string, title: string): string {
  return sha256(`task:${sourceSystem}:${sourceRecordId}:${normalizeTitle(title)}`);
}

export function commitmentDedupKey(
  sourceSystem: string,
  sourceRecordId: string,
  direction: string,
  text: string
): string {
  return sha256(`commitment:${direction}:${sourceSystem}:${sourceRecordId}:${normalizeTitle(text)}`);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface DedupableTask {
  title: string;
  confidence: number | null;
}

/**
 * Merge near-duplicate tasks within one extraction (e.g. the same commitment
 * appearing both as a formal action item and in the transcript). Keeps the
 * first occurrence, folding in the higher confidence.
 */
export function mergeExtractedTasks<T extends DedupableTask>(tasks: T[]): T[] {
  const kept: T[] = [];
  for (const task of tasks) {
    const existing = kept.find((k) => isDuplicateTitle(k.title, task.title));
    if (existing) {
      existing.confidence = Math.max(existing.confidence ?? 0, task.confidence ?? 0);
    } else {
      kept.push(task);
    }
  }
  return kept;
}

/**
 * Returns the matching existing title if the candidate duplicates any of them.
 */
export function findExistingDuplicate(
  candidateTitle: string,
  existingTitles: Array<{ id: string; title: string }>
): { id: string; title: string } | null {
  for (const existing of existingTitles) {
    if (isDuplicateTitle(candidateTitle, existing.title)) return existing;
  }
  return null;
}
