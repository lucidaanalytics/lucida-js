import type { Guide, GuideStep } from "../types.js";
import { defaultButtons } from "./render.js";

/** First locale among the candidates that the guide has text for: exact (fr-ca), then its language (fr). */
export function pickLocale(candidates: Array<string | undefined>, have: Set<string>): string | undefined {
  for (const c of candidates) {
    const l = c?.toLowerCase().replace("_", "-");
    if (!l) continue;
    if (have.has(l)) return l;
    const base = l.split("-")[0]!;
    if (have.has(base)) return base;
  }
  return undefined;
}

/**
 * The guide in the visitor's language. Candidates, best first: config.guides.locale, the person
 * property `locale`, the browser language. Steps or names with no text for it keep the default.
 */
export function localize(g: Guide, candidates: Array<string | undefined>): Guide {
  const have = new Set<string>();
  for (const s of g.steps) for (const k of Object.keys(s.i18n ?? {})) have.add(k.toLowerCase());
  for (const k of Object.keys(g.appearance?.i18n ?? {})) have.add(k.toLowerCase());
  const loc = pickLocale(candidates, have);
  if (!loc) return g;
  const find = <T>(m: Record<string, T> | undefined): T | undefined => {
    const k = Object.keys(m ?? {}).find((x) => x.toLowerCase() === loc);
    return k === undefined ? undefined : m![k];
  };
  const steps = g.steps.map((s, i): GuideStep => {
    const t = find(s.i18n);
    if (!t) return s;
    const labels = t.buttons;
    const buttons = labels && (s.buttons ?? defaultButtons(g.kind, i === g.steps.length - 1)).map((b, j) => ({ ...b, label: labels[j] ?? b.label }));
    return { ...s, ...(t.title !== undefined ? { title: t.title } : {}), ...(t.body !== undefined ? { body: t.body } : {}), ...(buttons ? { buttons } : {}) };
  });
  return { ...g, name: find(g.appearance?.i18n)?.name ?? g.name, steps };
}
