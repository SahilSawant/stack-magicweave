/**
 * tunables — the game's load-bearing numbers, readable without a rebuild.
 *
 * public/tunables.json ships beside index.html; the studio edits that file in
 * place and reloads the frame — no build step. The defaults passed in here are
 * the built-in fallback: a 404 (or any malformed JSON) means the game plays
 * exactly as shipped. Values read from the file are clamped to [min, max] so a
 * hand-edit cannot push the game somewhere unplayable.
 */

export interface TunableSpec {
  value: number;
  min: number;
  max: number;
  step: number;
}

export async function loadTunables<K extends string>(
  defaults: Record<K, TunableSpec>,
): Promise<Record<K, number>> {
  const out = {} as Record<K, number>;
  for (const key of Object.keys(defaults) as K[]) out[key] = defaults[key].value;
  try {
    const res = await fetch("./tunables.json");
    if (!res.ok) return out; // 404 → built-in defaults
    const raw: unknown = await res.json();
    if (typeof raw !== "object" || raw === null) return out;
    for (const key of Object.keys(defaults) as K[]) {
      const entry = (raw as Record<string, unknown>)[key];
      const v =
        typeof entry === "number"
          ? entry
          : typeof entry === "object" && entry !== null
            ? (entry as { value?: unknown }).value
            : undefined;
      if (typeof v === "number" && Number.isFinite(v)) {
        out[key] = Math.min(Math.max(v, defaults[key].min), defaults[key].max);
      }
    }
  } catch {
    /* a downloaded copy served without the file — the shipped feel stands */
  }
  return out;
}
