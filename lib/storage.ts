"use client";
import type { GroceryList, Profile, Session } from "./types";
import { ls } from "./util";
import { supabase } from "./supabase/client";

export const EMPTY_PROFILE: Profile = { zip: "", radius: 10, preferredStoreIds: [], storesCache: null, onboarded: false };

export interface Storage {
  loadProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
  loadLists(): Promise<GroceryList[]>;
  saveList(l: GroceryList): Promise<void>;
  deleteList(id: string): Promise<void>;
}

/** Guest storage: this browser only. */
export const LocalStorage: Storage = {
  async loadProfile() { return { ...EMPTY_PROFILE, ...(ls<Partial<Profile>>("cg.guest.profile") || {}) }; },
  async saveProfile(p) { ls("cg.guest.profile", p); },
  async loadLists() { return ls<GroceryList[]>("cg.guest.lists") || []; },
  async saveList(l) { const all = await this.loadLists(); const i = all.findIndex((x) => x.id === l.id); if (i >= 0) all[i] = l; else all.unshift(l); ls("cg.guest.lists", all); },
  async deleteList(id) { ls("cg.guest.lists", (await this.loadLists()).filter((x) => x.id !== id)); },
};

/** Signed-in storage: Supabase, rows scoped to the user by RLS. */
export function remoteStorage(session: Session): Storage {
  const sb = supabase()!; const uid = session.id;
  return {
    async loadProfile() {
      const { data, error } = await sb.from("profiles").select("zip,radius_miles,preferred_store_ids,stores_cache,onboarded").eq("id", uid).maybeSingle();
      if (error) throw error;
      if (!data) { await sb.from("profiles").upsert({ id: uid, display_name: session.name }); return { ...EMPTY_PROFILE }; }
      return { zip: data.zip ?? "", radius: data.radius_miles ?? 10, preferredStoreIds: data.preferred_store_ids ?? [], storesCache: data.stores_cache ?? null, onboarded: !!data.onboarded };
    },
    async saveProfile(p) {
      const { error } = await sb.from("profiles").upsert({ id: uid, zip: p.zip, radius_miles: p.radius, preferred_store_ids: p.preferredStoreIds, stores_cache: p.storesCache, onboarded: p.onboarded, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    async loadLists() {
      const { data, error } = await sb.from("lists").select("*").eq("user_id", uid).order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(rowToList);
    },
    async saveList(l) {
      const { error } = await sb.from("lists").upsert({ id: l.id, user_id: uid, name: l.name, status: l.status, saved: l.saved, items: l.items, quotes: l.quotes, created_at: new Date(l.createdAt).toISOString(), updated_at: new Date(l.updatedAt).toISOString(), finished_at: l.finishedAt ? new Date(l.finishedAt).toISOString() : null });
      if (error) throw error;
    },
    async deleteList(id) { const { error } = await sb.from("lists").delete().eq("id", id).eq("user_id", uid); if (error) throw error; },
  };
}
function rowToList(r: Record<string, unknown>): GroceryList {
  return { id: String(r.id), name: String(r.name ?? "Grocery run"), status: (r.status as GroceryList["status"]) ?? "active", saved: !!r.saved, items: (r.items as GroceryList["items"]) ?? [], quotes: (r.quotes as GroceryList["quotes"]) ?? {}, createdAt: Date.parse(String(r.created_at)), updatedAt: Date.parse(String(r.updated_at)), finishedAt: r.finished_at ? Date.parse(String(r.finished_at)) : undefined };
}
