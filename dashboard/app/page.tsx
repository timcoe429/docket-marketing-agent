"use client";

import { supabase } from "@/lib/supabase.js";
import { useEffect, useState } from "react";
import ChatPanel from "./components/ChatPanel";
import ContentTab from "./components/ContentTab";
import JobFeed from "./components/JobFeed";
import SEOTab from "./components/SEOTab";
import SecurityTab from "./components/SecurityTab";

type TabId = "security" | "seo" | "content" | "chat";

const TABS: { id: TabId; label: string }[] = [
  { id: "security", label: "Security" },
  { id: "seo", label: "SEO" },
  { id: "content", label: "Content" },
  { id: "chat", label: "Chat" },
];

const gradientBarStyle = {
  height: "5px",
  background: "linear-gradient(90deg, #185FB0 0%, #7EB10F 100%)",
} as const;

export default function Home() {
  const [tab, setTab] = useState<TabId>("security");
  const [realtimeStatus, setRealtimeStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");

  useEffect(() => {
    const channel = supabase
      .channel("realtime:header")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        () => {},
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected");
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setRealtimeStatus("disconnected");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f7fa] font-sans text-[#181e2b]">
      <div
        className="w-full shrink-0"
        style={gradientBarStyle}
        aria-hidden
      />

      <header className="shrink-0 border-b border-[#dce8f7] bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <h1 className="text-2xl font-black tracking-tight text-[#181e2b]">
            Marketing Agent
          </h1>
          <div className="flex items-center gap-2 text-sm font-bold text-[#181e2b]">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                realtimeStatus === "connected"
                  ? "bg-emerald-500"
                  : realtimeStatus === "connecting"
                    ? "bg-[#dce8f7]"
                    : "bg-red-500"
              }`}
              aria-hidden
            />
            <span>
              {realtimeStatus === "connected"
                ? "Connected"
                : realtimeStatus === "connecting"
                  ? "Connecting…"
                  : "Disconnected"}
            </span>
          </div>
        </div>
      </header>

      <nav className="shrink-0 border-b border-[#dce8f7] bg-[#f5f7fa]">
        <div className="mx-auto flex max-w-6xl gap-8 px-4 pt-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative -mb-px border-b-2 px-0.5 py-3 text-sm transition-colors ${
                tab === t.id
                  ? "border-[#185FB0] font-bold text-[#185FB0]"
                  : "border-transparent font-normal text-[#7a8494] hover:text-[#181e2b]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto p-4">
        <div className="rounded-[12px] bg-white p-6 shadow-[0_2px_8px_rgba(24,95,176,0.08)]">
          {tab === "security" && <SecurityTab />}
          {tab === "seo" && <SEOTab />}
          {tab === "content" && <ContentTab />}
          {tab === "chat" && <ChatPanel />}
        </div>
      </main>

      <div className="shrink-0">
        <div className="mx-auto max-w-6xl">
          <JobFeed />
        </div>
      </div>
    </div>
  );
}
