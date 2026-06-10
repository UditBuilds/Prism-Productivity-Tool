export interface TagColor {
  bg: string;
  text: string;
  border: string;
}

const TAG_COLORS: TagColor[] = [
  { bg: "bg-violet-950/60", text: "text-violet-400", border: "border-violet-800/40" },
  { bg: "bg-blue-950/60", text: "text-blue-400", border: "border-blue-800/40" },
  { bg: "bg-emerald-950/60", text: "text-emerald-400", border: "border-emerald-800/40" },
  { bg: "bg-amber-950/60", text: "text-amber-400", border: "border-amber-800/40" },
  { bg: "bg-rose-950/60", text: "text-rose-400", border: "border-rose-800/40" },
  { bg: "bg-cyan-950/60", text: "text-cyan-400", border: "border-cyan-800/40" },
];

/** Deterministic color per tag string (same tag → same color, always). */
export function getTagColor(tag: string): TagColor {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}
