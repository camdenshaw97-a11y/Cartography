import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface AddressSuggestion { label: string; street: string; city: string; state: string; zip: string; lat: number; lng: number }

const STATE_ABBR: Record<string, string> = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC" };

/**
 * GET /api/geocode?q=1773+sea+pines&lat=32.7&lng=-116.9
 * Address type-ahead via Photon (OpenStreetMap; free, no key). Biased toward lat/lng when given. US street addresses only.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 3) return NextResponse.json({ suggestions: [] });
  const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
  const params = new URLSearchParams({ q, limit: "8", lang: "en" });
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) { params.set("lat", String(lat)); params.set("lon", String(lng)); }
  try {
    const r = await fetch(`https://photon.komoot.io/api/?${params}`, { headers: { Accept: "application/json" }, next: { revalidate: 3600 } });
    if (!r.ok) return NextResponse.json({ suggestions: [] });
    const j = await r.json();
    const seen = new Set<string>();
    const suggestions: AddressSuggestion[] = [];
    for (const f of j.features ?? []) {
      const p = f.properties ?? {}; const [lng2, lat2] = f.geometry?.coordinates ?? [];
      if (p.countrycode && String(p.countrycode).toUpperCase() !== "US") continue;
      const street = [p.housenumber, p.street ?? (p.type === "street" ? p.name : "")].filter(Boolean).join(" ").trim();
      if (!street) continue; // only street-level results
      const city = p.city ?? p.town ?? p.village ?? p.locality ?? p.county ?? "";
      const stateRaw = String(p.state ?? ""); const state = STATE_ABBR[stateRaw.toLowerCase()] ?? stateRaw;
      const zip = String(p.postcode ?? "").slice(0, 5);
      const label = [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      if (seen.has(label)) continue; seen.add(label);
      suggestions.push({ label, street, city, state, zip, lat: Number(lat2), lng: Number(lng2) });
      if (suggestions.length >= 5) break;
    }
    return NextResponse.json({ suggestions });
  } catch { return NextResponse.json({ suggestions: [] }); }
}
