"use client";

import { supabase } from "@/lib/supabase.js";
import { useEffect, useState } from "react";

type JobRow = {
  id: string;
  type: string | null;
  status: string;
  created_at: string;
};

function formatCreatedAt(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s === "pending")
    return "bg-amber-100 text-amber-900";
  if (s === "running") return "bg-blue-100 text-blue-900";
  if (s === "done") return "bg-emerald-100 text-emerald-900";
  if (s === "error") return "bg-red-100 text-red-900";
  return "bg-zinc-100 text-zinc-800";
}

function sortAndTrim(rows: JobRow[]): JobRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, 20);
}

export default function JobFeed() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from("jobs")
        .select("id, type, status, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
        setJobs([]);
      } else {
        setJobs(sortAndTrim((data ?? []) as JobRow[]));
      }
      setLoading(false);
    }

    load();

    const channel = supabase
      .channel("realtime:job-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "jobs" },
        (payload) => {
          const row = payload.new as JobRow;
          setJobs((prev) =>
            sortAndTrim([row, ...prev.filter((j) => j.id !== row.id)]),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs" },
        (payload) => {
          const row = payload.new as JobRow;
          setJobs((prev) => {
            const next = prev.map((j) => (j.id === row.id ? row : j));
            if (!prev.some((j) => j.id === row.id)) {
              next.push(row);
            }
            return sortAndTrim(next);
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="border-t border-[#dce8f7] bg-white">
      <div className="border-b border-[#dce8f7] px-4 py-2">
        <h2 className="text-sm font-black text-[#181e2b]">Job feed</h2>
        <p className="text-xs text-[#7a8494]">Last 20 jobs · live updates</p>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {loading && (
          <p className="px-4 py-3 text-sm text-[#7a8494]">Loading jobs…</p>
        )}
        {error && (
          <p className="px-4 py-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && jobs.length === 0 && (
          <p className="px-4 py-3 text-sm text-[#7a8494]">No jobs yet</p>
        )}
        {!loading && !error && jobs.length > 0 && (
          <ul className="divide-y divide-[#dce8f7]">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-bold text-[#181e2b]">
                  {job.type ?? "—"}
                </span>
                <span
                  className={`shrink-0 rounded-[20px] px-2.5 py-1 text-xs font-bold ${statusBadgeClass(job.status)}`}
                >
                  {job.status}
                </span>
                <span className="shrink-0 text-xs font-normal tabular-nums text-[#7a8494]">
                  {formatCreatedAt(job.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
