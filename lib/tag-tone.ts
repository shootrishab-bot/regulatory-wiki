/**
 * A stable colour per tag NAME, so two different subjects on the same screen
 * look different from each other.
 *
 * This is differentiation, not a code. The colours carry no meaning -- green
 * does not mean safe and red does not mean urgent -- they exist so that a
 * page of twenty-five documents reads as a page of distinct subjects rather
 * than a column of identical chips. Status keeps its own separate, genuinely
 * meaningful palette in components/entry-list.tsx; nothing here touches it.
 *
 * Colour is never the only signal. Subject stays a filled chip, Instrument
 * Type an outlined chip with a leading dot, and both carry a title attribute
 * naming the facet -- so the Subject/Instrument distinction survives for
 * anyone who cannot tell these hues apart, exactly as it did before.
 *
 * The hash is deterministic and pure: the same tag gets the same colour on
 * every page, on every render, and on the server and the client alike (which
 * a random or index-based assignment would not, and which would hydrate-
 * mismatch). Twelve tones against ~139 subject tags means collisions are
 * certain; that is fine, because the job is telling apart the handful of
 * tags visible at once, not giving every tag in the corpus its own colour.
 */

export interface TagTone {
  /** Filled chip: Subject. */
  solid: string;
  /** Outlined chip: Instrument Type. */
  outline: string;
  /** The leading marker on an outlined chip. */
  dot: string;
}

/**
 * Twelve hues spread right around the wheel rather than clustered, so two
 * tags that happen to land next to each other on a row are unlikely to look
 * alike. An earlier set had rust, red and amber all within about 35 degrees
 * of each other, and two long subject names sharing a prefix came out as
 * near-identical warm pinks -- which defeats the entire point.
 */
const TONES: TagTone[] = [
  { solid: "bg-[#e6eef3] text-[#004062]", outline: "border-[#9fb9c6] text-[#004062]", dot: "bg-[#004062]" },
  { solid: "bg-[#e8eff9] text-[#1f5fa8]", outline: "border-[#a8bfdd] text-[#1f5fa8]", dot: "bg-[#1f5fa8]" },
  { solid: "bg-[#e3f0f4] text-[#0a6b85]", outline: "border-[#9dc4cf] text-[#0a6b85]", dot: "bg-[#0a6b85]" },
  { solid: "bg-[#e3f1ef] text-[#0f6b62]", outline: "border-[#9ec7c2] text-[#0f6b62]", dot: "bg-[#0f6b62]" },
  { solid: "bg-[#e8f3ec] text-[#2e7d4f]", outline: "border-[#a6cdb5] text-[#2e7d4f]", dot: "bg-[#2e7d4f]" },
  { solid: "bg-[#eff2e2] text-[#5d6b1f]", outline: "border-[#c0c894] text-[#5d6b1f]", dot: "bg-[#5d6b1f]" },
  { solid: "bg-[#f7efe0] text-[#8a5a0b]", outline: "border-[#d9c193] text-[#8a5a0b]", dot: "bg-[#8a5a0b]" },
  { solid: "bg-[#f8eaf1] text-[#a8326b]", outline: "border-[#e0aac6] text-[#a8326b]", dot: "bg-[#a8326b]" },
  { solid: "bg-[#f8eae9] text-[#a3312a]", outline: "border-[#dfaaa6] text-[#a3312a]", dot: "bg-[#a3312a]" },
  { solid: "bg-[#f4ecf1] text-[#7a3a66]", outline: "border-[#cfaec4] text-[#7a3a66]", dot: "bg-[#7a3a66]" },
  { solid: "bg-[#ededf7] text-[#4b3f8f]", outline: "border-[#b4aed6] text-[#4b3f8f]", dot: "bg-[#4b3f8f]" },
  { solid: "bg-[#eceff1] text-[#44525c]", outline: "border-[#b3bcc2] text-[#44525c]", dot: "bg-[#44525c]" },
];

/** FNV-1a, for no reason beyond being short, stable and well spread. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The colour for a tag seen on its own -- a document detail page, a single
 * chip somewhere. Stable for a given name, but with twelve tones against
 * ~139 subjects two tags CAN land on neighbouring hues, which is exactly
 * what you do not want when both are on screen at once. Where a whole list
 * is being rendered, use toneCycle() instead.
 */
export function tagTone(name: string): TagTone {
  return TONES[hash(name) % TONES.length];
}

/**
 * Tones for a KNOWN SET of tags, handed out in order of first appearance so
 * that no two distinct tags in the same list can come out the same colour
 * until the palette wraps at twelve.
 *
 * This deliberately trades cross-page stability for on-page distinction: the
 * same subject can be green in one result set and blue in another. That is
 * the right trade, because the colour never meant anything in the first
 * place -- it exists so that "are these eight rows the same subject or
 * three different ones?" is answerable at a glance, and that question is
 * always asked within one list.
 *
 * `offset` starts a second facet elsewhere in the palette, so a row's
 * subject and instrument chips do not habitually match each other.
 */
export function toneCycle(names: (string | null | undefined)[], offset = 0) {
  const tones = new Map<string, TagTone>();
  let next = 0;
  for (const name of names) {
    if (!name || tones.has(name)) continue;
    tones.set(name, TONES[(offset + next) % TONES.length]);
    next++;
  }
  return (name: string) => tones.get(name) ?? tagTone(name);
}
