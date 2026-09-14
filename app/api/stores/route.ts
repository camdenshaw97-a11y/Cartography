import { NextResponse } from "next/server";
import { searchGroceryStores } from "@/lib/foursquare";
import { geocodeAddress, geocodeZip } from "@/lib/geocode";
import { krogerChainFor, krogerConfigured, krogerLocations } from "@/lib/kroger";
import type { Center, Store } from "@/lib/types";

export const runtime = "nodejs";

function haversineMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * POST { zip, address?, radius, outside? } → { stores, center, zip }
 * When `address` is given it is geocoded and used as the center (so distances are from the user's door);
 * otherwise the ZIP's center point is used. If the address can't be matched, we fall back to the ZIP and say so.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const address = String(body.address ?? "").trim();
    let zip = String(body.zip ?? "").trim();
    const r = Math.min(50, Math.max(1, Number(body.radius) || 10));
    const outside = !!body.outside;

    let center: Center | null = null; let usedAddress = false;
    const home = body.home as Center | null | undefined;
    if (address && home && Number.isFinite(home.lat) && Number.isFinite(home.lng)) { center = { lat: home.lat, lng: home.lng, label: home.label || address }; usedAddress = true; }
    if (address && !center) {
      const g = await geocodeAddress(address);
      if (g) { center = { lat: g.lat, lng: g.lng, label: g.label }; usedAddress = true; if (g.zip && !/^\d{5}$/.test(zip)) zip = g.zip; }
    }
    if (!center) {
      if (!/^\d{5}$/.test(zip)) return NextResponse.json({ error: address ? "Couldn't find that address. Check the street and city, or enter a ZIP code." : "Enter a 5-digit ZIP code." }, { status: 400 });
      const z = await geocodeZip(zip); center = { lat: z.lat, lng: z.lng, label: z.label };
    }

    const stores: Store[] = await searchGroceryStores(outside ? { ...center, radiusMiles: r + 25, minMiles: r } : { ...center, radiusMiles: r });

    // Attach Kroger location IDs to Kroger-banner stores so /api/prices can fetch real prices.
    if (krogerConfigured() && /^\d{5}$/.test(zip) && stores.some((s) => krogerChainFor(s.chain))) {
      try {
        const kl = await krogerLocations(zip, outside ? r + 25 : r);
        for (const s of stores) {
          const chain = krogerChainFor(s.chain); if (!chain || s.lat == null || s.lng == null) continue;
          const cands = kl.filter((l) => l.chain.toUpperCase() === chain);
          let best: { locationId: string; d: number } | null = null;
          for (const l of cands) { const d = haversineMi({ lat: s.lat, lng: s.lng }, l); if (!best || d < best.d) best = { locationId: l.locationId, d }; }
          if (best && best.d < 1.5) s.krogerLocationId = best.locationId;
        }
      } catch (e) { console.warn("Kroger locations failed", e); }
    }
    return NextResponse.json({ stores, center, zip, usedAddress, warning: address && !usedAddress ? "Couldn't match that address — showing distances from the ZIP center instead." : undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Store lookup failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
