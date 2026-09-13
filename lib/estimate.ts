import Anthropic from "@anthropic-ai/sdk";
import type { Quote, Store } from "./types";
import { keyOf } from "./util";

export function estimatesConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

/**
 * Claude price estimates — used only for stores with no real price feed.
 * Every quote is tagged source:"estimate" so the UI can label it.
 */
export async function estimateQuotes(items: { name: string; note?: string }[], stores: Store[], zip: string): Promise<Record<string, Record<string, Quote>>> {
  const client = new Anthropic();
  const out: Record<string, Record<string, Quote>> = {};
  for (let i = 0; i < items.length; i += 8) {
    const chunk = items.slice(i, i + 8);
    const storeList = stores.map((s, n) => `${n + 1}. ${s.name}${s.address ? " (" + s.address + ")" : ""}`).join("\n");
    const itemList = chunk.map((it, n) => `${n + 1}. ${it.name}${it.note ? " — " + it.note : ""}`).join("\n");
    const prompt = `You are a grocery price estimator for ZIP ${zip} as of today. Estimate the current everyday shelf price (not sale price) for each item at each store, using each chain's typical pricing tier, store brands, and package sizes. Choose the most standard package size for a typical household and keep the size consistent across stores for the same item.

STORES:
${storeList}

ITEMS:
${itemList}

Reply with only JSON: an array with one object per item, in the same order as ITEMS: {"item": string, "quotes": [ {"store": <store number>, "match": "exact"|"similar"|"none", "product": <short product name incl. brand, or the closest substitute if similar>, "size": <package size>, "price": <number USD or null> } for every store ] }. No prose.`;
    const msg = await client.messages.create({ model: "claude-sonnet-4-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] });
    const text = msg.content.map((c) => ("text" in c ? c.text : "")).join("");
    const json = text.match(/\[[\s\S]*\]/)?.[0];
    if (!json) continue;
    let arr: { item: string; quotes: { store: number; match: string; product: string; size: string; price: number | null }[] }[] = [];
    try { arr = JSON.parse(json); } catch { continue; }
    arr.forEach((row, n) => {
      const it = chunk[n]; if (!it) return; const k = keyOf(it.name); out[k] = out[k] || {};
      for (const q of row.quotes ?? []) {
        const s = stores[(q.store | 0) - 1]; if (!s) continue;
        const price = typeof q.price === "number" && q.price > 0 ? Math.round(q.price * 100) / 100 : null;
        out[k][s.id] = { match: price == null ? "none" : q.match === "similar" ? "similar" : "exact", product: String(q.product || it.name), size: String(q.size || ""), price, source: "estimate", at: Date.now() };
      }
    });
  }
  return out;
}
