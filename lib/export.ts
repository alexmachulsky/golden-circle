import type { AnalysisResult } from "@/types";

// Strip ASCII controls and Unicode bidi/invisible characters from LLM output
// before it leaves the app (same hardening the copy-to-clipboard path uses).
function safe(s: string): string {
  return s.replace(/[\x00-\x1F\x7F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, " ").trim();
}

export function toMarkdown(result: AnalysisResult): string {
  const lines: string[] = [
    "# Golden Circle Analysis",
    "",
    "## WHY — Core belief",
    "",
    `> ${safe(result.why.statement)}`,
    "",
    `_${safe(result.why.depth_note)}_`,
    "",
    "## HOW — Differentiating actions",
    "",
  ];
  result.how.forEach((h, i) => {
    lines.push(`${i + 1}. **${safe(h.title)}** — ${safe(h.description)}`);
    lines.push(`   - _Why it's ownable:_ ${safe(h.uniqueness)}`);
  });
  lines.push("", "## WHAT — Products as proof", "");
  result.what.forEach((w, i) => {
    lines.push(`${i + 1}. **${safe(w.title)}** — ${safe(w.description)}`);
    lines.push(`   - _Proof of belief:_ ${safe(w.why_connection)}`);
  });
  lines.push("", "## Strategic advantage", "", safe(result.positioning_note), "");
  return lines.join("\n");
}

export function toJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

// Trigger a client-side download of `content` as a file. No network, no CSP
// impact — uses an object URL and a synthetic anchor click.
export function downloadFile(filename: string, content: string, mime: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
