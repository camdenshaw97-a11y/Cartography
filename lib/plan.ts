import type { GroceryList, Item, Quote, Store } from "./types";
import { AISLE_ORDER, CATALOG } from "./catalog";
import { keyOf } from "./util";

export function aisleOf(name: string): string {
  const k = keyOf(name);
  const hit = CATALOG.find((c) => keyOf(c[0]) === k) || CATALOG.find((c) => k.includes(keyOf(c[0])) || keyOf(c[0]).includes(k));
  return hit ? hit[1] : "Other";
}
const aisleIdx = (n: string) => { const i = AISLE_ORDER.indexOf(aisleOf(n)); return i < 0 ? 99 : i; };

export const itemQuotes = (list: GroceryList, item: Item): Record<string, Quote> => list.quotes[keyOf(item.name)] || {};
const usable = (q?: Quote) => !!q && q.price != null && q.match !== "none";
const effPrice = (q: Quote) => (q.promo != null && q.promo > 0 && q.promo < (q.price ?? Infinity) ? q.promo : (q.price as number));

export interface StoreGroupLine { item: Item; quote: Quote; val: number }
export interface StoreGroup { store: Store; items: StoreGroupLine[]; sub: number }

/** Default: every item goes to whichever in-scope store sells it cheapest. */
export function planByStore(list: GroceryList, storesFor: (item: Item) => Store[]) {
  const groups: Record<string, StoreGroup> = {}; let total = 0; const unpriced: Item[] = [];
  for (const it of list.items) {
    const q = itemQuotes(list, it);
    let best: { store: Store; quote: Quote; val: number } | null = null;
    for (const s of storesFor(it)) { const x = q[s.id]; if (!usable(x)) continue; const val = effPrice(x) * (it.qty || 1); if (!best || val < best.val) best = { store: s, quote: x, val }; }
    if (!best) { unpriced.push(it); continue; }
    const g = (groups[best.store.id] = groups[best.store.id] || { store: best.store, items: [], sub: 0 });
    g.items.push({ item: it, quote: best.quote, val: best.val }); g.sub += best.val; total += best.val;
  }
  const arr = Object.values(groups).sort((a, b) => b.items.length - a.items.length || a.sub - b.sub);
  arr.forEach((g) => g.items.sort((a, b) => aisleIdx(a.item.name) - aisleIdx(b.item.name)));
  return { groups: arr, total, unpriced };
}

export interface SingleLine { item: Item; quote: Quote | null; val: number | null }
export interface SingleResult { store: Store; total: number; exact: number; similar: number; missing: Item[]; lines: SingleLine[]; covered: number; n: number }

/** One-stop: rank in-radius stores by coverage (exact or substitute), then by cart total. */
export function planSingle(list: GroceryList, stores: Store[]) {
  const items = list.items.filter((it) => it.scope === "radius"); const others = list.items.filter((it) => it.scope !== "radius");
  const ranked: SingleResult[] = stores.map((store) => {
    let total = 0, exact = 0, similar = 0; const missing: Item[] = []; const lines: SingleLine[] = [];
    for (const it of items) {
      const x = itemQuotes(list, it)[store.id];
      if (!usable(x)) { missing.push(it); lines.push({ item: it, quote: null, val: null }); continue; }
      const val = effPrice(x) * (it.qty || 1); total += val; if (x.match === "similar") similar++; else exact++; lines.push({ item: it, quote: x, val });
    }
    lines.sort((a, b) => aisleIdx(a.item.name) - aisleIdx(b.item.name));
    return { store, total, exact, similar, missing, lines, covered: items.length - missing.length, n: items.length };
  }).sort((a, b) => b.covered - a.covered || a.total - b.total);
  return { ranked, others, n: items.length };
}

export function planTotalFor(l: GroceryList) {
  let t = 0;
  for (const it of l.items) { const q = l.quotes[keyOf(it.name)] || {}; let m: number | null = null; for (const id in q) { const x = q[id]; if (usable(x) && (m == null || effPrice(x) < m)) m = effPrice(x); } if (m != null) t += m * (it.qty || 1); }
  return t;
}
