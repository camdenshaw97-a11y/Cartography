import { NextResponse } from "next/server";
import { priceItems } from "@/lib/prices";
import { krogerConfigured } from "@/lib/kroger";
import { estimatesConfigured } from "@/lib/estimate";
import type { Store } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST { items:[{name,note}], stores:[Store], zip } → { quotes, sources, capabilities } */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items: { name: string; note?: string }[] = (body.items ?? []).filter((i: { name?: string }) => i?.name).slice(0, 60);
    const stores: Store[] = (body.stores ?? []).slice(0, 25);
    const zip = String(body.zip ?? "");
    if (!items.length || !stores.length) return NextResponse.json({ error: "Nothing to price." }, { status: 400 });
    const res = await priceItems(items, stores, zip);
    return NextResponse.json({ ...res, capabilities: { kroger: krogerConfigured(), estimates: estimatesConfigured() } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Pricing failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ capabilities: { kroger: krogerConfigured(), estimates: estimatesConfigured(), foursquare: !!process.env.FOURSQUARE_API_KEY } });
}
