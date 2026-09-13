import type { Store, StoreType } from "./types";

const FSQ_URL = "https://places-api.foursquare.com/places/search";
const FSQ_VERSION = "2025-06-17";

/** ZIP → lat/lng using the free Zippopotam service (no key). */
export async function geocodeZip(zip: string): Promise<{ lat: number; lng: number; city: string; state: string }> {
  const r = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, { next: { revalidate: 86400 * 30 } });
  if (!r.ok) throw new Error(`Unknown ZIP ${zip}`);
  const j = await r.json();
  const p = j.places?.[0];
  if (!p) throw new Error(`Unknown ZIP ${zip}`);
  return { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), city: p["place name"], state: p["state abbreviation"] };
}

const GROCERY_WORDS = /grocery|supermarket|warehouse|big box|department|health food|organic|natural food|discount store|superstore|hypermarket|farmers market|food market|market/i;
const EXCLUDE_WORDS = /convenience|gas station|liquor|smoke|vape|pharmacy$|drugstore|restaurant|cafe|coffee|bakery|deli$|butcher|fast food|pet store|dollar/i;
const EXCLUDE_NAMES = /7-eleven|circle k|am\/?pm|chevron|shell|arco|cvs|walgreens|rite aid|dollar tree|dollar general|family dollar|99 cents/i;

function classify(name: string, cats: string[]): StoreType {
  const n = name.toLowerCase();
  if (/costco|sam's club|sams club|bj's/.test(n) || cats.some((c) => /warehouse/i.test(c))) return "warehouse";
  if (/walmart|target|kmart|meijer|fred meyer/.test(n)) return "general";
  if (/aldi|grocery outlet|winco|food 4 less|foodmaxx|smart & final|smart and final|99 ranch|lidl/.test(n)) return "discount";
  if (/whole foods|sprouts|trader joe|natural|organic|erewhon|lazy acres|mother's market|jimbo/.test(n) || cats.some((c) => /health|organic|natural/i.test(c))) return "natural";
  return "supermarket";
}

/** Derive a chain name from a venue name: "Vons" from "Vons – Jamacha Rd", "Walmart" from "Walmart Supercenter". */
export function chainOf(name: string): string {
  const n = name.replace(/\s+#?\d+$/, "").trim();
  const known = ["Walmart", "Target", "Costco", "Vons", "Ralphs", "Albertsons", "Safeway", "Kroger", "Trader Joe's", "Whole Foods", "Sprouts", "Smart & Final", "Grocery Outlet", "Stater Bros", "Food 4 Less", "Aldi", "Sam's Club", "WinCo", "99 Ranch", "H Mart", "Northgate", "Cardenas", "El Super", "Vallarta", "Pavilions", "Gelson's", "Bristol Farms", "Erewhon", "Lazy Acres", "Jimbo's", "Barons", "Sprouts", "Fred Meyer", "King Soopers", "Fry's", "Smith's", "QFC", "Dillons", "Publix", "H-E-B", "Wegmans", "Meijer", "Hy-Vee", "Giant", "Stop & Shop", "ShopRite", "Lidl", "Food Lion", "Harris Teeter"];
  const hit = known.find((k) => n.toLowerCase().startsWith(k.toLowerCase()));
  if (hit) return hit;
  return n.split(/[–\-|(]/)[0].trim().split(" ").slice(0, 2).join(" ");
}

function miles(m: number) { return Math.round((m / 1609.344) * 10) / 10; }

export async function searchGroceryStores(opts: { lat: number; lng: number; radiusMiles: number; minMiles?: number }): Promise<Store[]> {
  const key = process.env.FOURSQUARE_API_KEY;
  if (!key) throw new Error("FOURSQUARE_API_KEY is not set");
  const radiusM = Math.min(100000, Math.round(opts.radiusMiles * 1609.344));
  const queries = ["grocery store", "supermarket", "warehouse club"];
  const seen = new Map<string, Store>();
  for (const query of queries) {
    const params = new URLSearchParams({ query, ll: `${opts.lat},${opts.lng}`, radius: String(radiusM), limit: "50", sort: "DISTANCE", fields: "fsq_place_id,name,location,distance,categories,latitude,longitude" });
    const r = await fetch(`${FSQ_URL}?${params}`, { headers: { Authorization: `Bearer ${key}`, "X-Places-Api-Version": FSQ_VERSION, Accept: "application/json" }, next: { revalidate: 3600 } });
    if (!r.ok) { const t = await r.text(); throw new Error(`Foursquare ${r.status}: ${t.slice(0, 200)}`); }
    const j = await r.json();
    for (const p of j.results ?? []) {
      const id: string = p.fsq_place_id ?? p.fsq_id; if (!id || seen.has(id)) continue;
      const cats: string[] = (p.categories ?? []).map((c: { name?: string }) => c.name ?? "");
      const name: string = p.name ?? "";
      if (EXCLUDE_NAMES.test(name)) continue;
      if (!cats.some((c) => GROCERY_WORDS.test(c)) && !/grocery|market|supermarket|foods?$/i.test(name)) continue;
      if (cats.some((c) => EXCLUDE_WORDS.test(c)) && !cats.some((c) => /grocery|supermarket/i.test(c))) continue;
      const dist = typeof p.distance === "number" ? miles(p.distance) : null;
      if (opts.minMiles && dist != null && dist < opts.minMiles) continue;
      const loc = p.location ?? {};
      const street = loc.address ?? ""; const city = loc.locality ?? ""; const state = loc.region ?? "";
      const chain = chainOf(name);
      const locator = street ? street.replace(/^\d+\s+/, "") : city; // "Jamacha Rd"
      seen.set(id, {
        id: "fsq-" + id,
        name: chain && locator ? `${chain} – ${locator}` : name,
        chain, type: classify(name, cats),
        address: [street, city, state].filter(Boolean).join(", "),
        distance: dist, lat: p.latitude ?? loc.latitude, lng: p.longitude ?? loc.longitude,
        outside: !!opts.minMiles,
      });
    }
  }
  return [...seen.values()].sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
}
