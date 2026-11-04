import { useCallback, useEffect, useRef, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { parseEntries, type BriefEntry } from "./brief";
import { brief as fixtureBrief, type Candidate } from "./fixtures";
import fixtureBriefSource from "../fixtures/daily-brief.md?raw";
import {
  cancelGeneration,
  classifyGenerationError,
  detectInference,
  generateBrief,
  onPhase,
  type Detection,
  type GenerationError,
  type PhaseEvent,
} from "./generation";
import { loadBriefRun, recordGeneration, type BriefRecord, type StoreState } from "./store";

/**
 * The Daily Brief's state machine. "ready" means a brief for the current
 * window is on screen — the persisted generation run, or the committed
 * fixture when the store is running on fixture data (browser mode). "cta"
 * means the window has candidates but no brief yet; "empty" means the scan
 * found nothing to recap. Generation drives "generating" → the spec's
 * progress panel, phase events, elapsed time, and Cancel.
 */
export type BriefStatus = "loading" | "ready" | "cta" | "empty" | "generating" | "error";

export interface BriefView {
  entries: BriefEntry[];
  /** The brief's local date, YYYY-MM-DD, for the masthead. */
  date: string;
  /** Run facts for the strip: the scan's counts plus how the brief was made. */
  since: string;
  tools: string;
  sessions: number;
  pairs: number;
  candidateCount: number;
  inferenceCli: string | null;
  /** Wall-clock time the brief appeared, HH:MM. */
  generatedAt: string | null;
  candidatesById: Map<string, Candidate>;
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Local YYYY-MM-DD, the way the engine dates archive files. */
function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localArchivePath(home: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const base = home.endsWith("/") ? home : `${home}/`;
  return `${base}.claude/morning-recap/recap-${date}.md`;
}

function runToView(run: BriefRecord, store: StoreState): BriefView {
  return {
    entries: parseEntries(run.raw_output),
    date: run.started_at ? localDate(run.started_at) : store.since,
    since: run.since,
    tools: "claude + codex",
    sessions: store.sessions,
    pairs: store.pairs,
    candidateCount: store.windowCandidates,
    inferenceCli: run.inference_cli,
    generatedAt: run.started_at ? timeOfDay(run.started_at) : null,
    candidatesById: new Map(store.candidates.map((c) => [c.id, c])),
  };
}

function fixtureView(store: StoreState): BriefView {
  return {
    entries: parseEntries(fixtureBriefSource),
    date: fixtureBrief.meta.generatedAt.slice(0, 10),
    since: fixtureBrief.meta.since,
    tools: fixtureBrief.meta.tools.replace("+", " + "),
    sessions: store.sessions,
    pairs: store.pairs,
    candidateCount: store.windowCandidates,
    inferenceCli: fixtureBrief.meta.inference,
    generatedAt: fixtureBrief.meta.generatedAt.split(" ")[1],
    candidatesById: new Map(store.candidates.map((c) => [c.id, c])),
  };
}

export function useBrief(store: StoreState | null) {
  const [status, setStatus] = useState<BriefStatus>("loading");
  const [view, setView] = useState<BriefView | null>(null);
  const [error, setError] = useState<GenerationError | null>(null);
  const [phase, setPhase] = useState<PhaseEvent | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** CLI preflight for the write-the-brief screen, spec §Inference. */
  const [detection, setDetection] = useState<Detection | null>(null);
  const cancelledRef = useRef(false);
  const phaseRef = useRef<PhaseEvent | null>(null);
  const startedAtRef = useRef(0);

  const showBrief = useCallback(
    async (current: StoreState) => {
      const run = await loadBriefRun(current.since);
      setView(run ? runToView(run, current) : null);
      if (!run) {
        setStatus(current.windowCandidates > 0 ? "cta" : "empty");
        const found = await detectInference().catch(() => null);
        setDetection(found);
      } else {
        setStatus("ready");
      }
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    if (!store) return;
    if (store.source === "fixture") {
      setView(fixtureView(store));
      setStatus("ready");
      return;
    }
    showBrief(store).catch(() => {
      if (alive) setStatus("error");
    });
    return () => {
      alive = false;
    };
  }, [store, showBrief]);

  const generate = useCallback(async () => {
    if (!store || store.source !== "live") return;
    cancelledRef.current = false;
    setStatus("generating");
    setPhase(null);
    phaseRef.current = null;
    setElapsed(0);
    startedAtRef.current = Date.now();
    const startedAt = new Date().toISOString();
    const timer = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 1000);
    const stopPhases = await onPhase((p) => {
      phaseRef.current = p;
      setPhase(p);
    });
    try {
      const markdown = await generateBrief();
      const entries = parseEntries(markdown);
      if (entries.length === 0) {
        setError({
          kind: "failed",
          title: "Generation returned nothing usable.",
          detail: markdown,
        });
        setStatus("error");
        return;
      }
      const finishedAt = new Date().toISOString();
      const archivePath = await homeDir().then(localArchivePath, () => null);
      const cliUsed = (phaseRef.current as PhaseEvent | null)?.cli ?? "auto";
      await recordGeneration({
        startedAt,
        finishedAt,
        since: store.since,
        tools: "claude+codex",
        sessions: store.sessions,
        pairs: store.pairs,
        status: "done",
        inferenceCli: cliUsed,
        archivePath,
        rawOutput: markdown,
      });
      await showBrief(store);
    } catch (e) {
      if (cancelledRef.current) {
        // Back to where we were: the old brief, or the write-the-brief view.
        await showBrief(store);
        return;
      }
      setError(classifyGenerationError(e instanceof Error ? e.message : String(e)));
      setStatus("error");
    } finally {
      clearInterval(timer);
      stopPhases();
    }
  }, [store, showBrief]);

  const cancel = useCallback(async () => {
    cancelledRef.current = true;
    await cancelGeneration();
  }, []);

  /** Leave the error card back to the pre-generation view. */
  const dismissError = useCallback(async () => {
    if (!store) return;
    await showBrief(store);
  }, [store, showBrief]);

  return { status, view, error, phase, elapsed, detection, generate, cancel, dismissError };
}
