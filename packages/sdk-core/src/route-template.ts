const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Route template for a concrete path: `/blog/hello/comments/7` with params `{slug: "hello", id: "7"}` becomes
 * `/blog/[slug]/comments/[id]`; array params (catch-all) collapse to `[...name]`. Values that do not appear in the
 * path are ignored; a segment is only claimed once, so equal values in different params stay distinct.
 */
export function routeTemplate(pathname: string, params: Record<string, string | string[] | undefined> = {}): string {
  const segs = pathname.split("/");
  const claimed = new Set<number>();
  const at = (i: number) => safeDecode(segs[i] ?? "");
  const out = segs.map((s) => s);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      const want = value.map(safeDecode);
      for (let i = 0; i + want.length <= segs.length; i++) {
        if (want.length && want.every((w, j) => at(i + j) === w && !claimed.has(i + j))) {
          want.forEach((_, j) => claimed.add(i + j));
          out[i] = `[...${name}]`;
          for (let j = 1; j < want.length; j++) out[i + j] = "\0";
          break;
        }
      }
    } else {
      const want = safeDecode(value);
      const i = segs.findIndex((_, k) => k > 0 && !claimed.has(k) && at(k) === want);
      if (i > 0) {
        claimed.add(i);
        out[i] = `[${name}]`;
      }
    }
  }
  return out.filter((s) => s !== "\0").join("/") || "/";
}
