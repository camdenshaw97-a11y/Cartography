import type { Quote } from "./types";

const BASE = "https://api.kroger.com/v1";
/** Chains served by the Kroger Public API (banner name → Kroger `filter.chain` value). */
export const KROGER_BANNERS: Record<string, string> = {
  "ralphs": "RALPHS", "food 4 less": "FOOD4LESS", "foods co": "FOODSCO", "kroger": "KROGER", "fred meyer": "FRED", "king soopers": "KINGSOOPERS",
  "fry's": "FRYS", "frys": "FRYS", "smith's": "SMITHS", "smiths": "SMITHS", "qfc": "QFC", "dillons": "DILLONS", "baker's": "BAKERS", "city market": "CITYMARKET",
  "gerbes": "GERBES", "jay c": "JAYC", "mariano's": "MARIANOS", "metro market": "METROMARKET", "pick 'n save": "PICKNSAVE", "pay less": "PAYLESS", "harris teeter": "HARRISTEETER", "owen's": "OWENS", "ruler foods": "RULER",
};
export function krogerChainFor(chainOrName: string): string | null {
  const n = chainOrName.toLowerCase();
  for (const k of Object.keys(KROGER_BANNERS)) if (n.includes(k)) return KROGER_BANNERS[k];
  return null;
}
export function krogerConfigured() { return !!(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET); }

let tokenCache: { token: string; exp: number } | null = null;
export async function krogerToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 30_000) return tokenCache.token;
  const id = process.env.KROGER_CLIENT_ID, secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Kroger credentials not set");
  const r = await fetch(`${BASE}/connect/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
    body: "grant_type=client_credentials&scope=product.compact",
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Kroger auth ${r.status}`);
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 1800) * 1000 };
  return tokenCache.token;
}

export interface KrogerLocation { locationId: string; chain: string; name: string; lat: number; lng: number; address: string }
export async function krogerLocations(zip: string, radiusMiles: number): Promise<KrogerLocation[]> {
  const token = await krogerToken();
  const params = new URLSearchParams({ "filter.zipCode.near": zip, "filter.radiusInMiles": String(Math.min(100, Math.max(1, Math.round(radiusMiles + 5)))), "filter.limit": "50" });
  const r = await fetch(`${BASE}/locations?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, next: { revalidate: 86400 } });
  if (!r.ok) throw new Error(`Kroger locations ${r.status}`);
  const j = await r.json();
  return (j.data ?? []).map((l: Record<string, unknown>) => {
    const g = (l.geolocation ?? {}) as { latitude?: number; longitude?: number };
    const a = (l.address ?? {}) as { addressLine1?: string; city?: string; state?: string };
    return { locationId: String(l.locationId), chain: String(l.chain ?? ""), name: String(l.name ?? ""), lat: g.latitude ?? 0, lng: g.longitude ?? 0, address: [a.addressLine1, a.city, a.state].filter(Boolean).join(", ") };
  });
}

interface KrogerProduct { productId: string; description: string; brand?: string; items?: { size?: string; price?: { regular?: number; promo?: number } }[] }
export async function krogerSearch(term: string, locationId: string): Promise<KrogerProduct[]> {
  const token = await krogerToken();
  const params = new URLSearchParams({ "filter.term": term.slice(0, 60), "filter.locationId": locationId, "filter.limit": "8" });
  const r = await fetch(`${BASE}/products?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, next: { revalidate: 3600 } });
  if (!r.ok) throw new Error(`Kroger products ${r.status}`);
  const j = await r.json();
  return j.data ?? [];
}

/** Pick the product that best represents "the item" — prefer priced items whose description contains the search words, cheapest of those. */
export async function krogerQuote(term: string, locationId: string): Promise<Quote> {
  const products = await krogerSearch(term, locationId);
  const words = term.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const scored = products.flatMap((p) => {
    const it = p.items?.find((i) => i.price && (i.price.regular ?? 0) > 0);
    if (!it) return [];
    const d = (p.description ?? "").toLowerCase();
    const hits = words.filter((w) => d.includes(w)).length;
    return [{ p, it, hits, price: it.price!.regular as number, promo: it.price!.promo && it.price!.promo > 0 ? it.price!.promo : null }];
  });
  if (!scored.length) return { match: "none", product: "", size: "", price: null, source: "kroger", at: Date.now() };
  const maxHits = Math.max(...scored.map((s) => s.hits));
  const best = scored.filter((s) => s.hits === maxHits).sort((a, b) => a.price - b.price)[0];
  const exact = words.length === 0 || maxHits >= Math.max(1, Math.ceil(words.length * 0.6));
  return { match: exact ? "exact" : "similar", product: [best.p.brand, best.p.description].filter(Boolean).join(" ").slice(0, 80), size: best.it.size ?? "", price: best.price, promo: best.promo, source: "kroger", at: Date.now() };
}
