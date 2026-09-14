import type { Center } from "./types";

/** ZIP → center point via the free Zippopotam service (no key). */
export async function geocodeZip(zip: string): Promise<Center & { city: string; state: string }> {
  const r = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, { next: { revalidate: 86400 * 30 } });
  if (!r.ok) throw new Error(`Unknown ZIP ${zip}`);
  const j = await r.json();
  const p = j.places?.[0];
  if (!p) throw new Error(`Unknown ZIP ${zip}`);
  const city = p["place name"], state = p["state abbreviation"];
  return { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), label: `${city}, ${state} ${zip}`, city, state };
}

/**
 * Street address → point via the US Census Bureau geocoder (free, no key, US only).
 * Returns null when the address can't be matched so the caller can fall back to the ZIP.
 */
export async function geocodeAddress(address: string): Promise<(Center & { zip?: string }) | null> {
  const params = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
  const r = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`, { next: { revalidate: 86400 * 30 } });
  if (!r.ok) return null;
  const j = await r.json();
  const m = j?.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  const zip = m.addressComponents?.zip as string | undefined;
  return { lat: Number(m.coordinates.y), lng: Number(m.coordinates.x), label: String(m.matchedAddress ?? address), zip };
}
