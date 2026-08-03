import { describe, it, expect } from "vitest";
import { parseVTodos } from "@/lib/reminders/caldav";

const URL = "https://caldav.icloud.com/x/todo.ics";

describe("parseVTodos", () => {
  it("parses a reminder with a due date and a #tag", () => {
    const ical = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTODO",
      "UID:abc-123",
      "SUMMARY:Send the MSA to Standard Bank #heya",
      "DUE;VALUE=DATE:20260805",
      "STATUS:NEEDS-ACTION",
      "PRIORITY:1",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");
    const [t] = parseVTodos(ical, URL);
    expect(t.uid).toBe("abc-123");
    expect(t.title).toBe("Send the MSA to Standard Bank");
    expect(t.tags).toEqual(["heya"]);
    expect(t.dueDate).toBe("2026-08-05");
    expect(t.completed).toBe(false);
    expect(t.priority).toBe(1);
    expect(t.url).toBe(URL);
  });

  it("handles datetime DUE and marks completed", () => {
    const ical = "BEGIN:VTODO\r\nUID:2\r\nSUMMARY:Call Thabo\r\nDUE:20260806T090000Z\r\nSTATUS:COMPLETED\r\nEND:VTODO";
    const [t] = parseVTodos(ical, URL);
    expect(t.dueDate).toBe("2026-08-06");
    expect(t.completed).toBe(true);
  });

  it("unfolds folded lines and unescapes commas", () => {
    // RFC5545 line folding: continuation lines start with a space.
    const ical = "BEGIN:VTODO\r\nUID:3\r\nSUMMARY:Prep board pack\\, Q3 sec\r\n tion #jic\r\nEND:VTODO";
    const [t] = parseVTodos(ical, URL);
    expect(t.title).toBe("Prep board pack, Q3 section");
    expect(t.tags).toEqual(["jic"]);
  });

  it("returns no due date when absent, and every VTODO in the payload", () => {
    const ical = "BEGIN:VTODO\r\nUID:4\r\nSUMMARY:Renew lease\r\nEND:VTODO\r\nBEGIN:VTODO\r\nUID:5\r\nSUMMARY:Book flights\r\nEND:VTODO";
    const todos = parseVTodos(ical, URL);
    expect(todos).toHaveLength(2);
    expect(todos[0].dueDate).toBeNull();
    expect(todos.map((t) => t.uid)).toEqual(["4", "5"]);
  });
});
