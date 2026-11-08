import { useState } from 'react';
import { candidates as scanCandidates, scan } from '../src/fixtures';
import { parseEntries } from '../src/brief';
import raw from '../fixtures/daily-brief.md?raw';

const scenario = new URLSearchParams(location.search).get('state') || 'brief';
const entries = parseEntries(raw);
entries[0] = { ...entries[0], title: 'SQLite write-ahead logging, long-running transactions, and diagnosing a database lock across concurrent connections', body: `${entries[0].body} For a production service, inspect the migration process and its transaction lifecycle before changing the timeout: a retry can hide an unfinished transaction while requests continue to accumulate. The diagnostic bundle is written to \`/var/lib/recap/diagnostics/production/long-running-transactions-and-write-ahead-log-checkpoint-status.json\` so an operator can compare it with the application logs.`, rest: `${entries[0].rest} Inspect the migration process and its transaction lifecycle before changing the timeout; retries can hide an unfinished transaction while requests continue to accumulate. Diagnostic output: \`/var/lib/recap/diagnostics/production/long-running-transactions-and-write-ahead-log-checkpoint-status.json\`.` };
const candidates = scanCandidates.map((c, i) => i === 0 ? { ...c, cwd: '/workspace/production/services/learning-platform/diagnostics/long-running-transactions-and-write-ahead-log-checkpoint-status', userMessage: `${c.userMessage} The diagnostic file is /var/lib/recap/diagnostics/production/long-running-transactions-and-write-ahead-log-checkpoint-status.json and the migration runs alongside the application.` } : c);
const concepts = entries.map((e, i) => ({ id: i + 1, date: '2026-11-03', title: e.title, body: e.body, sourceIds: e.sources, review: { dueOn: '2026-11-03', reviews: 2, lapses: 0, lastGrade: 'got-it' } }));
const overview = { due: scenario === 'review-caught-up' ? 0 : 3, inReview: 12, next: { on: '2026-11-04', count: 3 }, learnedThisWeek: 5 };
const store = { source: scenario === 'signals-error' ? 'fixture' : 'live', since: scan.since, candidates: scenario === 'signals-empty' ? [] : candidates, sessions: scan.sessions, pairs: scan.pairs, tools: scan.tools, windowCandidates: candidates.length, ...(scenario === 'signals-error' ? { error: 'The local engine could not complete the scan.' } : {}) };
const noop = () => {};
let settings = { inference_cli: 'auto', custom_cli_path: '', timeout_sec: 300, onboarded: true, show_engine_details: false };
export const initStore = async () => scenario === 'refusal' ? { ...store, refusal: 'Internal validation failed' } : store;
export const loadDueOverview = async () => overview;
export const onDueChanged = () => noop;
export const loadBriefRun = async () => null;
export const getSettings = async () => {
  if (scenario === 'settings-loading') return new Promise(() => {});
  if (scenario === 'settings-error') throw new Error('Settings are unavailable');
  return { ...settings, onboarded: scenario !== 'first-run' };
};
export const setSettings = async next => { settings = { ...next }; };
export const detectInference = async () => ({ cli: 'claude', path: '/usr/local/bin/claude', considered: ['claude', 'codex', 'pi'], login_shell: true, path_dirs: ['/usr/local/bin', '/usr/bin', '/bin'], clis: ['claude', 'codex', 'pi'].map(name => ({ name, path: `/usr/local/bin/${name}`, version: '1.0.0', runs: scenario !== 'settings-tool-error' || name !== 'claude' })) });
export const detectSources = async () => {
  if (scenario === 'settings-sources-error') throw new Error('Internal diagnostic');
  return { sources: ['claude', 'codex', 'pi'].map(tool => ({ tool, found: true, root: `/Users/example/.${tool}/sessions`, sessions: 24, recentSessions: 4 })) };
};

export function useBrief() {
  const status = scenario === 'brief-no-cli' ? 'cta' : scenario === 'brief-load-error' ? 'error' : scenario.startsWith('brief-') ? scenario.slice(6) : 'ready';
  return { status, view: { entries, date: '2026-11-03', since: scan.since, tools: 'claude + codex + pi', sessions: scan.sessions, pairs: scan.pairs, candidateCount: candidates.length, inferenceCli: 'claude', generatedAt: '07:04', candidatesById: new Map(candidates.map(c => [c.id, c])) }, error: { kind: 'failed', title: 'The brief could not be written.', detail: 'The inference command stopped before it returned a response.' }, loadError: scenario === 'brief-load-error', phase: null, elapsed: 12, detection: scenario === 'brief-no-cli' ? { cli: null } : null, generate: noop, cancel: noop, dismissError: noop };
}
export function useLibrary() {
  const [selected, setSelected] = useState(scenario === 'reader' ? concepts[0] : null);
  const [query, setQuery] = useState('');
  const list = scenario === 'library-empty' ? [] : concepts;
  return { concepts: list, query, setQuery, groups: list.length ? [{ date: '2026-11-03', concepts: list }] : [], selected, sources: candidates.slice(0, 2), loading: scenario === 'library-loading', loadError: scenario === 'library-error' ? "Couldn't load the library." : null, sourceError: null, reviewError: null, reviewPending: false, retry: noop, retrySources: noop, open: setSelected, close: () => setSelected(null), addReview: noop, removeReview: noop, inWindow: () => true };
}
export function useReview() {
  const [revealed, setRevealed] = useState(scenario === 'review-revealed');
  const [expanded, setExpanded] = useState(false);
  const empty = scenario === 'review-caught-up';
  return { queue: scenario === 'review-loading' || scenario === 'review-error' ? null : empty ? [] : concepts.slice(0, 3), overview, current: empty ? null : concepts[0], done: false, index: 0, revealed, expanded, sources: expanded ? candidates.slice(0, 2) : null, sourceLoading: false, sourceError: false, loadError: scenario === 'review-error', gradeError: false, refresh: noop, reschedule: null, tally: { kept: 0, fuzzy: 0, lost: 0 }, reveal: () => setRevealed(true), expand: () => setExpanded(!expanded), grade: noop, today: '2026-11-03' };
}
