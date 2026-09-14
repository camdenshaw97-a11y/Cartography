import { NextResponse } from "next/server";
import { krogerConfigured, krogerLocations, krogerSearch, krogerToken } from "@/lib/kroger";
import { estimatesConfigured } from "@/lib/estimate";

export const runtime = "nodejs";

/**
 * GET /api/health?zip=92019&term=large%20eggs
 * Reports which integrations are configured and runs a live Kroger check:
 * auth → locations near the ZIP → a product search at the first location.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const zip = url.searchParams.get("zip") ?? "";
  const term = url.searchParams.get("term") ?? "large eggs";
  const out: Record<string, unknown> = {
    configured: { foursquare: !!process.env.FOURSQUARE_API_KEY, kroger: krogerConfigured(), estimates: estimatesConfigured(), supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL },
  };
  if (krogerConfigured()) {
    try { await krogerToken(); out.krogerAuth = "ok"; }
    catch (e) { out.krogerAuth = "FAILED: " + (e instanceof Error ? e.message : String(e)); return NextResponse.json(out); }
    if (/^\d{5}$/.test(zip)) {
      try {
        const locs = await krogerLocations(zip, 10);
        out.krogerLocations = locs.slice(0, 10).map((l) => ({ id: l.locationId, chain: l.chain, name: l.name, address: l.address }));
        if (locs[0]) {
          const products = await krogerSearch(term, locs[0].locationId);
          out.krogerSample = { at: locs[0].name, term, results: products.slice(0, 5).map((p) => ({ description: p.description, brand: p.brand, size: p.items?.[0]?.size, price: p.items?.[0]?.price })) };
        }
      } catch (e) { out.krogerLookup = "FAILED: " + (e instanceof Error ? e.message : String(e)); }
    }
  }
  return NextResponse.json(out);
}
