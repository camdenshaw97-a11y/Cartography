export type Scope = "radius" | "online" | "outside";
export type StoreType = "supermarket" | "warehouse" | "discount" | "natural" | "general" | "online";

export interface Store {
  id: string;
  name: string;          // "Vons – Jamacha Rd"
  chain: string;         // "Vons"
  type: StoreType;
  address: string;
  distance: number | null; // miles
  lat?: number;
  lng?: number;
  outside?: boolean;
  krogerLocationId?: string; // set when this store is a Kroger banner with a matching Kroger location
}

export interface Item {
  id: string;
  name: string;
  qty: number;
  note: string;
  scope: Scope;
  done: boolean;
  addedAt: number;
}

export type Match = "exact" | "similar" | "none";
export type QuoteSource = "kroger" | "estimate" | "none";

export interface Quote {
  match: Match;
  product: string;
  size: string;
  price: number | null;
  promo?: number | null;
  source: QuoteSource;
  at: number;
}

export type Quotes = Record<string, Record<string, Quote>>; // itemKey -> storeId -> quote

export interface GroceryList {
  id: string;
  name: string;
  items: Item[];
  quotes: Quotes;
  status: "active" | "done" | "template";
  saved: boolean;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

export interface Center { lat: number; lng: number; label: string }
export interface StoresCache { zip: string; address?: string; radius: number; stores: Store[]; at: number; center?: Center }

export interface Profile {
  zip: string;
  address: string;        // optional street address; when set, distances are measured from here
  home?: Center | null;   // coordinates for `address` (from the suggestion picked), used directly when present
  radius: number;
  preferredStoreIds: string[];
  storesCache: StoresCache | null;
  onboarded: boolean;
}

export interface Session { type: "guest" | "user"; id: string; name: string; email?: string }
