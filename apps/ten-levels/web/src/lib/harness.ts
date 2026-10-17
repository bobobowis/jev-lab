import { computed, ref, watch } from "vue";
import type { OptionMeta, Support } from "./api";

/**
 * The coding agents the server can start, and the one this browser picked. The pick is remembered
 * per browser; an empty pick, or one that is no longer installed, falls back to the server's default.
 */
export interface HarnessInfo { name: string; available: boolean; install?: string }

export const HARNESS_LABELS: Record<string, string> = { pi: "pi", claude: "Claude Code", codex: "Codex" };
export const harnessLabel = (name: string | null | undefined) => (name ? HARNESS_LABELS[name] ?? name : "");

const KEY = "jev10.harness";
function load(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export const harnesses = ref<HarnessInfo[]>([]);
const serverDefault = ref<string | null>(null);
export const picked = ref<string>(load());
watch(picked, (v) => { try { localStorage.setItem(KEY, v); } catch { /* not remembered */ } });

let loading: Promise<void> | null = null;
/** Reads /api/state once per page load. */
export function loadHarnesses(): Promise<void> {
  loading ??= fetch("/api/state").then((r) => r.json()).then((s) => {
    harnesses.value = s.harnesses ?? [];
    serverDefault.value = s.harness ?? null;
  }).catch(() => { loading = null; });
  return loading;
}

/** The harness a session starts in, or null when none is installed. */
export const harness = computed<string | null>(() => {
  const chosen = harnesses.value.find((h) => h.name === picked.value && h.available);
  return chosen ? chosen.name : serverDefault.value;
});

/** How an option runs in the current harness; full when the option carries no matrix. */
export function supportFor(option: OptionMeta | null | undefined, name = harness.value): Support {
  return (name && option?.support?.[name]) || { status: "full" };
}
