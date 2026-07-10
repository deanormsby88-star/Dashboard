import { describe, expect, it } from "vitest";
import {
  findExistingDuplicate,
  isDuplicateTitle,
  mergeExtractedTasks,
  normalizeTitle,
  taskDedupKey,
  titleSimilarity,
} from "@/lib/dedup";

describe("normalizeTitle", () => {
  it("lowercases, strips punctuation and stopwords", () => {
    expect(normalizeTitle("Review the June Discrepancy Report!")).toBe(
      "review june discrepancy report"
    );
  });

  it("collapses whitespace", () => {
    expect(normalizeTitle("  Send   Sam    options ")).toBe("send sam options");
  });
});

describe("titleSimilarity", () => {
  it("is 1 for identical normalized titles", () => {
    expect(titleSimilarity("Review the report", "review report")).toBe(1);
  });

  it("is high for near-duplicates", () => {
    expect(
      titleSimilarity("Review June discrepancy report", "Review the June discrepancy report in detail")
    ).toBeGreaterThanOrEqual(0.6);
  });

  it("is low for unrelated titles", () => {
    expect(titleSimilarity("Approve supplier artwork", "Send Sam AI automation options")).toBeLessThan(0.2);
  });

  it("handles empty strings", () => {
    expect(titleSimilarity("", "Review report")).toBe(0);
  });
});

describe("isDuplicateTitle", () => {
  it("detects exact normalized matches", () => {
    expect(isDuplicateTitle("Review June discrepancy report", "review the June discrepancy report")).toBe(true);
  });

  it("detects the same commitment phrased slightly differently", () => {
    expect(
      isDuplicateTitle("Send Sam AI automation options", "Send Sam the AI automation options")
    ).toBe(true);
  });

  it("does not merge different work items", () => {
    expect(isDuplicateTitle("Approve supplier artwork", "Review June discrepancy report")).toBe(false);
    expect(
      isDuplicateTitle("Follow up: Lawrence on revised team proposal", "Send Sam AI automation options")
    ).toBe(false);
  });
});

describe("taskDedupKey", () => {
  it("is stable for identical inputs (replay safety)", () => {
    const a = taskDedupKey("circleback", "cb-1", "Review report");
    const b = taskDedupKey("circleback", "cb-1", "review the report!");
    expect(a).toBe(b);
  });

  it("differs across meetings and titles", () => {
    expect(taskDedupKey("circleback", "cb-1", "Review report")).not.toBe(
      taskDedupKey("circleback", "cb-2", "Review report")
    );
    expect(taskDedupKey("circleback", "cb-1", "Review report")).not.toBe(
      taskDedupKey("circleback", "cb-1", "Approve artwork")
    );
  });
});

describe("mergeExtractedTasks", () => {
  it("merges the same commitment from action item and transcript into one task", () => {
    const merged = mergeExtractedTasks([
      { title: "Send Sam AI automation options", confidence: 0.7 },
      { title: "Send Sam the AI automation options", confidence: 0.9 },
      { title: "Approve supplier artwork", confidence: 0.8 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].confidence).toBe(0.9); // takes the higher confidence
  });

  it("keeps distinct tasks untouched", () => {
    const merged = mergeExtractedTasks([
      { title: "Review June discrepancy report", confidence: 0.9 },
      { title: "Approve supplier artwork", confidence: 0.8 },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("findExistingDuplicate", () => {
  it("finds duplicates against existing DeanOS tasks", () => {
    const existing = [
      { id: "1", title: "Review June discrepancy report" },
      { id: "2", title: "Approve supplier artwork" },
    ];
    expect(findExistingDuplicate("Review the June discrepancy report", existing)?.id).toBe("1");
    expect(findExistingDuplicate("Chase freight quote", existing)).toBeNull();
  });
});
