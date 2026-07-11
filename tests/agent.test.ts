import { describe, expect, it } from "vitest";
import { parseCommand } from "@/lib/assistant/commands";

describe("parseCommand — conversational routing", () => {
  it("treats bare single command words as commands", () => {
    expect(parseCommand("brief")).toEqual({ cmd: "brief", args: "" });
    expect(parseCommand("  WAITING ")).toEqual({ cmd: "waiting", args: "" });
    expect(parseCommand("sync")).toEqual({ cmd: "sync", args: "" });
  });

  it("treats slash commands as commands, with args", () => {
    expect(parseCommand("/prep Lawrence Cole")).toEqual({ cmd: "prep", args: "Lawrence Cole" });
    expect(parseCommand("/brief")).toEqual({ cmd: "brief", args: "" });
    expect(parseCommand("/capture chase the quote")).toEqual({ cmd: "capture", args: "chase the quote" });
  });

  it("routes a command word FOLLOWED BY prose (no slash) to conversation", () => {
    // This is the key change: 'prep Lawrence' now chats rather than firing
    // the terse command, so natural language wins.
    expect(parseCommand("prep Lawrence for tomorrow")).toEqual({
      cmd: "chat",
      args: "prep Lawrence for tomorrow",
    });
    expect(parseCommand("people who owe me money")).toEqual({
      cmd: "chat",
      args: "people who owe me money",
    });
  });

  it("routes plain questions and statements to conversation", () => {
    expect(parseCommand("who's waiting on me?")).toEqual({ cmd: "chat", args: "who's waiting on me?" });
    expect(parseCommand("add a task to call the bank tomorrow")).toEqual({
      cmd: "chat",
      args: "add a task to call the bank tomorrow",
    });
    expect(parseCommand("what should I do first today")).toEqual({
      cmd: "chat",
      args: "what should I do first today",
    });
  });
});
