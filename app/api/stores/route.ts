import { NextResponse } from "next/server";
import { geocodeZip, searchGroceryStores } from "@/lib/foursquare";
import { krogerChainFor, krogerConfigured, krogerLocations } from "@/lib/kroger";
import type { Store } from "@/lib/types";

export const runtime = "nodejs";

function haversineMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** POST { zip, radius, outside? } → { stores, center } */
export async function POST(req: Request) {
  try {
    const { zip, radius = 10, outside = false } = await req.json();
    if (!/^\d{5}$/.test(String(zip))) return NextResponse.json({ error: "Enter a 5-digit ZIP code." }, { status: 400 });
    const r = Math.min(50, Math.max(1, Number(radius) || 10));
    const center = await geocodeZip(String(zip));
    const stores: Store[] = await searchGroceryStores(outside ? { ...center, radiusMiles: r + 25, minMiles: r } : { ...center, radiusMiles: r });

    // Attach Kroger location IDs to Kroger-banner stores so /api/prices can fetch real prices.
    if (krogerConfigured() && stores.some((s) => krogerChainFor(s.chain))) {
      try {
        const kl = await krogerLocations(String(zip), outside ? r + 25 : r);
        for (const s of stores) {
          const chain = krogerChainFor(s.chain); if (!chain || s.lat == null || s.lng == null) continue;
          const cands = kl.filter((l) => l.chain.toUpperCase() === chain);
          let best: { locationId: string; d: number } | null = null;
          for (const l of cands) { const d = haversineMi({ lat: s.lat, lng: s.lng }, l); if (!best || d < best.d) best = { locationId: l.locationId, d }; }
          if (best && best.d < 1.5) s.krogerLocationId = best.locationId;
        }
      } catch (e) { console.warn("Kroger locations failed", e); }
    }
    return NextResponse.json({ stores, center });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Store lookup failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
