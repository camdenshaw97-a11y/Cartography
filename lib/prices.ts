import type { Quote, Quotes, Store } from "./types";
import { krogerConfigured, krogerQuote } from "./kroger";
import { estimateQuotes, estimatesConfigured } from "./estimate";
import { keyOf } from "./util";

export interface PriceRequestItem { name: string; note?: string }

/**
 * Price every item at every store. Real feeds first (Kroger), then estimates for the rest, then "none".
 */
export async function priceItems(items: PriceRequestItem[], stores: Store[], zip: string): Promise<{ quotes: Quotes; sources: { kroger: number; estimate: number; none: number } }> {
  const quotes: Quotes = {};
  const sources = { kroger: 0, estimate: 0, none: 0 };
  const put = (itemKey: string, storeId: string, q: Quote) => { (quotes[itemKey] = quotes[itemKey] || {})[storeId] = q; sources[q.source === "none" ? "none" : q.source]++; };

  // 1. Kroger — real prices, one call per item × Kroger store, with modest concurrency.
  const krogerStores = krogerConfigured() ? stores.filter((s) => s.krogerLocationId) : [];
  const jobs: (() => Promise<void>)[] = [];
  for (const s of krogerStores) for (const it of items) jobs.push(async () => {
    try { put(keyOf(it.name), s.id, await krogerQuote(it.note ? `${it.name} ${it.note}` : it.name, s.krogerLocationId!)); }
    catch (e) { console.warn("kroger quote failed", it.name, e); put(keyOf(it.name), s.id, { match: "none", product: "", size: "", price: null, source: "none", at: Date.now() }); }
  });
  await runPool(jobs, 4);

  // 2. Estimates for everything else (or "none" when estimates aren't configured).
  const rest = stores.filter((s) => !krogerStores.includes(s));
  if (rest.length) {
    if (estimatesConfigured()) {
      const est = await estimateQuotes(items, rest, zip);
      for (const k in est) for (const sid in est[k]) put(k, sid, est[k][sid]);
    } else {
      for (const it of items) for (const s of rest) put(keyOf(it.name), s.id, { match: "none", product: "", size: "", price: null, source: "none", at: Date.now() });
    }
  }
  return { quotes, sources };
}

async function runPool(jobs: (() => Promise<void>)[], n: number) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const j = jobs[i++]; await j(); } }));
}
