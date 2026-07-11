"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import clsx from "clsx";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const QUICK_COMMANDS = ["brief", "focus", "sync", "waiting", "slipping", "risks", "help"];

export default function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Morning. Ask me anything, or try a command — brief, focus, sync, waiting, prep [name], capture [anything]. Type help for the full list.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as { reply?: string; error?: string } | null;
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: res.ok && body?.reply ? body.reply : `Something went wrong: ${body?.error ?? res.status}`,
        },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Network error — try again." }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.map((m, i) => (
          <div key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={clsx(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "border border-slate-200 bg-white text-slate-800 shadow-soft dark:border-white/5 dark:bg-[#212327] dark:text-slate-200"
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_COMMANDS.map((c) => (
            <button
              key={c}
              onClick={() => send(c)}
              disabled={busy}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {c}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask, or type a command…"
            className="form-input max-h-40 min-h-[2.6rem] flex-1 resize-y"
            disabled={busy}
          />
          <button type="submit" className="btn-primary h-[2.6rem] !px-4" disabled={busy || !input.trim()}>
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
