"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GroceryList, Item, Profile, Quote, Scope, Session, Store } from "@/lib/types";
import { AISLE_ORDER, CATALOG, QUICK_ADD } from "@/lib/catalog";
import { storeColor, storeInitials } from "@/lib/brand";
import { aisleOf, itemQuotes, planByStore, planSingle, planTotalFor } from "@/lib/plan";
import { EMPTY_PROFILE, LocalStorage, remoteStorage, type Storage } from "@/lib/storage";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { clamp, fmtDate, keyOf, ls, money, uid } from "@/lib/util";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

const ONLINE_STORES: Store[] = [
  { id: "o-amazon", name: "Amazon", chain: "Amazon", type: "online", distance: null, address: "amazon.com" },
  { id: "o-walmart", name: "Walmart.com", chain: "Walmart", type: "online", distance: null, address: "walmart.com" },
  { id: "o-target", name: "Target.com", chain: "Target", type: "online", distance: null, address: "target.com" },
  { id: "o-instacart", name: "Instacart", chain: "Instacart", type: "online", distance: null, address: "instacart.com" },
];
type Tab = "list" | "plan" | "stores" | "saved";
type SheetState =
  | { kind: "location"; firstRun?: boolean }
  | { kind: "item"; id: string }
  | { kind: "auth"; mode: "in" | "up" }
  | { kind: "account" }
  | { kind: "savedList"; id: string }
  | { kind: "ask"; title: string; value: string; placeholder?: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; message: string; label: string; danger?: boolean; resolve: (v: boolean) => void }
  | null;

const newList = (name?: string): GroceryList => ({ id: crypto.randomUUID(), name: name || "Grocery run", items: [], quotes: {}, createdAt: Date.now(), updatedAt: Date.now(), status: "active", saved: false });

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = booting
  const [profile, setProfile] = useState<Profile>({ ...EMPTY_PROFILE });
  const [list, setList] = useState<GroceryList | null>(null);
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [tab, setTab] = useState<Tab>("list");
  const [mode, setMode] = useState<"store" | "single">("store");
  const [scope, setScope] = useState<Scope>("radius");
  const [outsideStores, setOutsideStores] = useState<Store[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [openStore, setOpenStore] = useState<string>("");
  const [query, setQuery] = useState("");
  const [toast, setToastMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((m: string) => { setToastMsg(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToastMsg(null), 2200); }, []);
  const storage: Storage | null = useMemo(() => (session ? (session.type === "user" ? remoteStorage(session) : LocalStorage) : null), [session]);

  /* ---------- boot & auth ---------- */
  useEffect(() => {
    const sb = supabase();
    const guest = ls<Session>("cg.session");
    (async () => {
      if (sb) {
        const { data } = await sb.auth.getSession();
        if (data.session) { setSession(userSession(data.session.user)); return; }
      }
      setSession(guest?.type === "guest" ? guest : null);
    })();
    if (!sb) return;
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { if (s) setSession(userSession(s.user)); else setSession((cur) => (cur?.type === "user" ? null : cur)); });
    return () => sub.subscription.unsubscribe();
  }, []);
  function userSession(u: { id: string; email?: string; user_metadata?: Record<string, unknown> }): Session {
    const name = (u.user_metadata?.display_name as string) || (u.email ?? "").split("@")[0] || "You";
    return { type: "user", id: u.id, name, email: u.email };
  }

  useEffect(() => { if (storage) loadAccount(storage); else { setList(null); setLists([]); setProfile({ ...EMPTY_PROFILE }); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);
  async function loadAccount(st: Storage) {
    try {
      const p = await st.loadProfile(); const all = await st.loadLists();
      const active = all.find((l) => l.status === "active" && !l.saved) || newList();
      if (!all.includes(active)) all.unshift(active);
      if (!p.onboarded && all.some((l) => Object.keys(l.quotes || {}).length)) { p.onboarded = true; st.saveProfile(p).catch(() => {}); }
      setProfile(p); setLists(all); setList(active);
      if (!p.zip) setSheet({ kind: "location", firstRun: true });
    } catch (e) { console.warn(e); setErr("Couldn't load your account data."); setList(newList()); }
  }

  /* ---------- persistence helpers ---------- */
  const profileRef = useRef(profile); profileRef.current = profile;
  const listRef = useRef(list); listRef.current = list;
  async function saveProfile(next: Profile) { setProfile(next); try { await storage?.saveProfile(next); } catch (e) { console.warn(e); showToast("Couldn't save settings"); } }
  async function saveList(next: GroceryList) {
    next = { ...next, updatedAt: Date.now() }; setList(next);
    setLists((all) => { const i = all.findIndex((x) => x.id === next.id); return i >= 0 ? all.map((x) => (x.id === next.id ? next : x)) : [next, ...all]; });
    try { await storage?.saveList(next); } catch (e) { console.warn(e); showToast("Couldn't sync list"); }
  }

  /* ---------- store scope ---------- */
  const radiusStores = useMemo(() => { const c = profile.storesCache; if (!c || c.zip !== profile.zip) return []; return c.stores.filter((s) => s.distance == null || s.distance <= profile.radius); }, [profile]);
  const activeStores = useMemo(() => { const chosen = radiusStores.filter((s) => profile.preferredStoreIds.includes(s.id)); return chosen.length ? chosen : radiusStores; }, [radiusStores, profile.preferredStoreIds]);
  const storesForScope = useCallback((sc: Scope) => (sc === "online" ? ONLINE_STORES : sc === "outside" ? outsideStores : activeStores), [activeStores, outsideStores]);
  const missingQuotes = useMemo(() => (list ? list.items.filter((it) => { const q = itemQuotes(list, it); const st = storesForScope(it.scope); return st.length > 0 && st.some((s) => !q[s.id]); }) : []), [list, storesForScope]);

  /* ---------- network ---------- */
  async function api<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j as T;
  }
  async function ensureStores(force = false): Promise<Profile | null> {
    const p = profileRef.current;
    if (!p.zip) { setSheet({ kind: "location", firstRun: true }); return null; }
    const c = p.storesCache;
    if (!force && c && c.zip === p.zip && c.radius >= p.radius && Date.now() - c.at < 7 * 864e5) return p;
    setBusy(`Finding grocery stores within ${p.radius} mi of ${p.zip}…`); setErr(null);
    try {
      const { stores } = await api<{ stores: Store[] }>("/api/stores", { zip: p.zip, radius: p.radius });
      const next: Profile = { ...p, storesCache: { zip: p.zip, radius: p.radius, stores, at: Date.now() }, preferredStoreIds: p.preferredStoreIds.filter((id) => stores.some((s) => s.id === id)) };
      await saveProfile(next); return next;
    } catch (e) { setErr(e instanceof Error ? e.message : "Store lookup failed"); return null; }
    finally { setBusy(null); }
  }
  async function ensureOutside(): Promise<Store[] | null> {
    if (outsideStores.length) return outsideStores;
    const p = profileRef.current; setBusy(`Looking for stores beyond ${p.radius} mi…`);
    try { const { stores } = await api<{ stores: Store[] }>("/api/stores", { zip: p.zip, radius: p.radius, outside: true }); setOutsideStores(stores); return stores; }
    catch (e) { setErr(e instanceof Error ? e.message : "Store lookup failed"); return null; }
    finally { setBusy(null); }
  }
  async function organize(force = false) {
    const l = listRef.current; if (!l || !l.items.length) return;
    const p = await ensureStores(); if (!p) return;
    const inRadius = (() => { const c = p.storesCache!; const all = c.stores.filter((s) => s.distance == null || s.distance <= p.radius); const chosen = all.filter((s) => p.preferredStoreIds.includes(s.id)); return chosen.length ? chosen : all; })();
    let outside = outsideStores;
    if (l.items.some((i) => i.scope === "outside")) { const o = await ensureOutside(); if (!o) return; outside = o; }
    const sf = (sc: Scope) => (sc === "online" ? ONLINE_STORES : sc === "outside" ? outside : inRadius);
    const byScope: Partial<Record<Scope, Item[]>> = {};
    for (const it of l.items) { const q = itemQuotes(l, it); const st = sf(it.scope); if (force || st.some((s) => !q[s.id])) (byScope[it.scope] = byScope[it.scope] || []).push(it); }
    let quotes = { ...l.quotes };
    if (Object.keys(byScope).length) {
      setErr(null);
      try {
        for (const sc of Object.keys(byScope) as Scope[]) {
          const stores = sf(sc); if (!stores.length) continue;
          const items = byScope[sc]!;
          setBusy(`Pricing ${items.length} ${items.length === 1 ? "item" : "items"} at ${stores.length} ${stores.length === 1 ? "store" : "stores"}…`);
          const got = await api<{ quotes: Record<string, Record<string, Quote>> }>("/api/prices", { items: items.map((i) => ({ name: i.name, note: i.note })), stores, zip: p.zip });
          for (const k in got.quotes) quotes = { ...quotes, [k]: { ...(quotes[k] || {}), ...got.quotes[k] } };
        }
        await saveList({ ...l, quotes });
      } catch (e) { setErr(e instanceof Error ? e.message : "Pricing failed"); }
      finally { setBusy(null); }
    }
    if (!p.onboarded && Object.keys(quotes).length) saveProfile({ ...profileRef.current, onboarded: true });
    setTab("plan"); window.scrollTo({ top: 0 });
  }

  /* ---------- list actions ---------- */
  function addItem(name: string, sc: Scope) {
    const l = listRef.current; name = name.trim(); if (!name || !l) return;
    const ex = l.items.find((i) => keyOf(i.name) === keyOf(name) && i.scope === sc);
    const items = ex ? l.items.map((i) => (i === ex ? { ...i, qty: (i.qty || 1) + 1 } : i)) : [...l.items, { id: uid(), name, qty: 1, note: "", scope: sc, done: false, addedAt: Date.now() }];
    if (ex) showToast(`${name} ×${(ex.qty || 1) + 1}`);
    setQuery(""); saveList({ ...l, items }); inputRef.current?.focus();
  }
  const ask = (title: string, value: string, placeholder?: string) => new Promise<string | null>((resolve) => setSheet({ kind: "ask", title, value, placeholder, resolve }));
  const confirm = (title: string, message: string, label: string, danger?: boolean) => new Promise<boolean>((resolve) => setSheet({ kind: "confirm", title, message, label, danger, resolve }));
  async function saveAsTemplate() {
    const l = listRef.current; if (!l?.items.length) return;
    const name = await ask("Name this list", l.name === "Grocery run" ? "Weekly staples" : l.name, "Weekly staples"); if (!name) return;
    const t: GroceryList = { ...newList(name), saved: true, status: "template", items: l.items.map((i) => ({ ...i, id: uid(), done: false })) };
    setLists((all) => [t, ...all]); try { await storage?.saveList(t); showToast("Saved list created"); } catch { showToast("Couldn't save list"); }
  }
  async function finishTrip() {
    const l = listRef.current; if (!l?.items.length) return;
    const done = { ...l, status: "done" as const, finishedAt: Date.now() }; await saveList(done);
    const fresh = newList(); await saveList(fresh); setTab("list"); showToast(`Trip saved · ${done.items.length} items`);
  }
  async function useList(src: GroceryList, how: "add" | "replace") {
    const l = listRef.current; if (!l) return;
    const items = src.items.map((i) => ({ ...i, id: uid(), done: false }));
    const merged = how === "replace" ? items : [...l.items, ...items.filter((it) => !l.items.some((x) => keyOf(x.name) === keyOf(it.name) && x.scope === it.scope))];
    await saveList({ ...l, items: merged, quotes: { ...(src.quotes || {}), ...l.quotes } });
    setSheet(null); setTab("list"); showToast(how === "replace" ? "List replaced" : "Items added");
  }
  async function signOut() { const sb = supabase(); if (session?.type === "user" && sb) await sb.auth.signOut(); ls("cg.session", null); setSession(null); setSheet(null); }
  function startGuest() { const s: Session = { type: "guest", id: "guest", name: "Guest" }; ls("cg.session", s); setSession(s); }

  /* ---------- derived ---------- */
  const onboarding = !profile.onboarded;
  const recentNames = useMemo(() => [...new Map(lists.flatMap((l) => l.items).map((i) => [keyOf(i.name), i.name])).values()], [lists]);
  const suggestions = useMemo(() => {
    const q = keyOf(query); if (!q) return [] as [string, string][]; const seen = new Set<string>(); const out: [string, string][] = [];
    const push = (n: string, src: string) => { if (seen.has(keyOf(n)) || keyOf(n) === q) return; seen.add(keyOf(n)); out.push([n, src]); };
    recentNames.filter((n) => keyOf(n).includes(q)).forEach((n) => push(n, "Recent"));
    CATALOG.filter((c) => keyOf(c[0]).startsWith(q)).forEach((c) => push(c[0], c[1]));
    CATALOG.filter((c) => keyOf(c[0]).includes(q)).forEach((c) => push(c[0], c[1]));
    return out.slice(0, 6);
  }, [query, recentNames]);

  /* ---------- render ---------- */
  if (session === undefined) return <div className="app"><div className="status"><span className="spin" />Loading…</div></div>;
  if (!session) return <Welcome onGuest={startGuest} onAuth={(m) => setSheet({ kind: "auth", mode: m })} sheet={renderSheet()} />;
  if (!list) return <div className="app"><div className="status"><span className="spin" />Loading your lists…</div></div>;

  const subtitle = profile.zip ? `${profile.zip} · ${profile.radius} mi · ${activeStores.length || "—"} stores` : "Set your location";
  const title = { list: list.name, plan: "Plan", stores: "Stores", saved: "Saved" }[tab];
  const n = list.items.length;

  return (
    <div className="app">
      <header className="nav">
        <div className="title">{title}<small>{subtitle}</small></div>
        <button className={"avatar" + (session.type === "guest" ? " guest" : "")} aria-label="Account" onClick={() => setSheet({ kind: "account" })}>{session.type === "guest" ? <Icon name="person" /> : session.name.slice(0, 1).toUpperCase()}</button>
      </header>
      <nav className="tabbar" aria-label="Sections"><div className="in">
        {([["list", "List", "list", n], ["plan", "Plan", "plan", 0], ["stores", "Stores", "store", 0], ["saved", "Saved", "saved", 0]] as [Tab, string, string, number][]).map(([id, label, ic, b]) => (
          <button key={id} className={"tab" + (tab === id ? " on" : "")} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setQuery(""); window.scrollTo({ top: 0 }); }}><Icon name={ic} /><span>{label}</span>{b ? <span className="badge">{b}</span> : null}</button>
        ))}
      </div></nav>
      <main className="main">
        {err && <div className="err" role="alert">{err} <button className="btn plain sm" style={{ minHeight: 28 }} onClick={() => setErr(null)}>Dismiss</button></div>}
        {tab === "list" && renderList()}
        {tab === "plan" && renderPlan()}
        {tab === "stores" && renderStores()}
        {tab === "saved" && renderSaved()}
      </main>
      {renderSheet()}
      <div className={"toast" + (toast ? " show" : "")} role="status" aria-live="polite">{toast}</div>
    </div>
  );

  function Steps({ n, label }: { n: number; label: string }) { return <div className="steps"><span className="dots">{[1, 2, 3].map((i) => <i key={i} className={i <= n ? "on" : ""} />)}</span><span>Step {n} of 3 · {label}</span></div>; }

  function renderList() {
    const l = list!; const items = l.items;
    const grouped: Record<string, Item[]> = {};
    items.forEach((it) => { const a = it.scope === "online" ? "Online" : it.scope === "outside" ? "Out of radius" : aisleOf(it.name); (grouped[a] = grouped[a] || []).push(it); });
    const order = [...AISLE_ORDER, "Online", "Out of radius"];
    const sections = Object.keys(grouped).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const scopeBtn = (id: Scope, label: string, ic: string, cls: string) => <button type="button" className={scope === id ? "on " + cls : ""} aria-pressed={scope === id} onClick={() => { setScope(id); inputRef.current?.focus(); if (id === "outside" && profile.zip) ensureOutside(); }}><Icon name={ic} />{label}</button>;
    const placeholder = scope === "online" ? "Search online retailers…" : scope === "outside" ? `Search stores beyond ${profile.radius} mi…` : "Add an item…";
    return (
      <>
        <div className="composer">
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); addItem(query, scope); }}>
            <Icon name="search" />
            <input ref={inputRef} id="itemInput" type="text" placeholder={placeholder} autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" aria-label="Add an item" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="submit" className="add" aria-label="Add item">Add</button>
          </form>
          <div className="scopes" role="group" aria-label="Where to look">
            {scopeBtn("radius", `Within ${profile.radius || 10} mi`, "pin", "")}
            {scopeBtn("online", "Online", "globe", "blue")}
            {scopeBtn("outside", "Out of Radius", "far", "amber")}
          </div>
          {suggestions.length > 0 && <div className="suggest" role="listbox">{suggestions.map(([name, src]) => <button key={name} type="button" role="option" aria-selected={false} onClick={() => addItem(name, scope)}><Icon name="plus" /><span>{name}</span><span className="s">{src}</span></button>)}</div>}
        </div>
        {onboarding && !items.length && <Steps n={3} label="Build your first list" />}
        {!items.length && (
          <div className="card">
            <div className="empty"><Icon name="cart" /><h3>{onboarding ? "Add your first items" : "Your list is empty"}</h3>
              <p>{onboarding ? `Type anything above, or tap a few staples to start. When you're done, Price & Organize splits the list across your ${activeStores.length || ""} stores.` : 'Type anything — "eggs", "oat milk", "dog food". Switch to Online or Out of Radius for items your local stores might not carry.'}</p></div>
            {onboarding && <div className="quick" aria-label="Quick add">{QUICK_ADD.map((q) => <button key={q} type="button" onClick={() => addItem(q, scope)}><Icon name="plus" />{q}</button>)}</div>}
          </div>
        )}
        {onboarding && items.length > 0 && <div className="ribbon"><Icon name="spark" /><span>{items.length} {items.length === 1 ? "item" : "items"} in. Add the rest, then tap Price & Organize below to see your plan.</span></div>}
        {sections.map((sec) => <div className="group" key={sec}><div className="hd"><span>{sec}</span><span>{grouped[sec].length}</span></div><div className="card">{grouped[sec].map((it) => <ItemRow key={it.id} it={it} />)}</div></div>)}
        {items.length > 0 && (
          <div className="stack">
            {busy && <div className="card"><div className="status"><span className="spin" /><span>{busy}</span></div></div>}
            <button className="btn primary block" disabled={!!busy} onClick={() => organize(false)}><Icon name="spark" />{missingQuotes.length ? `Price & Organize${missingQuotes.length === items.length ? "" : ` (${missingQuotes.length} new)`}` : "View Plan"}</button>
            <div className="hrow"><button className="btn sm" onClick={saveAsTemplate}><Icon name="saved" />Save as List</button><button className="btn sm danger" onClick={async () => { if (await confirm("Clear List", "Remove every item from this list? Prices you've already fetched are kept for next time.", "Clear List", true)) saveList({ ...l, items: [] }); }}><Icon name="trash" />Clear</button></div>
            <p className="note" style={{ textAlign: "center" }}>Prices marked <b>live</b> come from the store's own feed; <b>est.</b> are Claude estimates — check the shelf before you trust a total.</p>
          </div>
        )}
      </>
    );
  }
  function ItemRow({ it }: { it: Item }) {
    const q = itemQuotes(list!, it); const st = storesForScope(it.scope); const priced = st.filter((s) => q[s.id] && q[s.id].price != null && q[s.id].match !== "none");
    let best: Store | null = null; for (const s of priced) if (!best || (q[s.id].price as number) < (q[best.id].price as number)) best = s;
    const sub = best ? `${best.chain || best.name} · ${money(q[best.id].price)}${q[best.id].match === "similar" ? " (substitute)" : ""}${priced.length > 1 ? ` · cheapest of ${priced.length}` : ""}` : it.note || (it.scope === "online" ? "Online only" : it.scope === "outside" ? "Beyond your radius" : "Not priced yet");
    return (
      <button className="row tap" onClick={() => setSheet({ kind: "item", id: it.id })}>
        <span className="lead"><Icon name={it.scope === "online" ? "globe" : it.scope === "outside" ? "far" : "tag"} /></span>
        <span className="body"><span className="t">{it.name}{it.qty > 1 && <span className="val"> ×{it.qty}</span>}</span><span className="s">{sub}</span></span>
        <span className="trail">{best && <SourceChip q={q[best.id]} />}{best && <span className="price">{money((q[best.id].price as number) * (it.qty || 1))}</span>}<Icon name="chev" /></span>
      </button>
    );
  }
  function SourceChip({ q }: { q: Quote }) { return q.source === "kroger" ? <span className="chip green" title="Live price from the store's feed">live</span> : q.source === "estimate" ? <span className="chip amber" title="Claude estimate">est.</span> : null; }
  function Big({ n }: { n: number }) { const s = money(n); const [d, c] = s.split("."); return <div className="big">{d}<small>.{c}</small></div>; }

  function renderPlan() {
    const l = list!;
    if (!l.items.length) return <div className="card"><div className="empty"><Icon name="plan" /><h3>Nothing to plan yet</h3><p>Add items on the List tab, then tap Price & Organize.</p></div></div>;
    if (busy) return <div className="card"><div className="status"><span className="spin" /><span>{busy}</span></div><div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}><div className="skel" style={{ width: "70%" }} /><div className="skel" style={{ width: "50%" }} /><div className="skel" style={{ width: "60%" }} /></div></div>;
    const seg = <div className="seg" role="tablist"><button role="tab" className={mode === "store" ? "on" : ""} aria-selected={mode === "store"} onClick={() => setMode("store")}>Split by Store</button><button role="tab" className={mode === "single" ? "on" : ""} aria-selected={mode === "single"} onClick={() => setMode("single")}>Single Store</button></div>;
    if (!Object.keys(l.quotes).length) return <>{seg}<div className="card"><div className="empty"><Icon name="tag" /><h3>Not priced yet</h3><p>Cartography needs prices before it can plan.</p><button className="btn primary" onClick={() => organize(false)}><Icon name="spark" />Price & Organize</button></div></div></>;
    return <>{seg}{mode === "store" ? <ByStore /> : <Single />}
      <div className="stack"><button className="btn tint block" onClick={() => organize(true)}><Icon name="refresh" />Refresh Prices</button><button className="btn block" onClick={async () => { if (await confirm("Finish Trip", "This trip moves to Past Trips and a fresh list starts.", "Finish Trip")) finishTrip(); }}><Icon name="check" />Finish Trip</button><p className="note" style={{ textAlign: "center" }}>Priced {fmtDate(l.updatedAt)}. Live prices from store feeds where available; estimates elsewhere.</p></div></>;
  }
  function ByStore() {
    const l = list!; const p = planByStore(l, (it) => storesForScope(it.scope)); const single = planSingle(l, activeStores).ranked.find((r) => r.covered === r.n && r.n > 0);
    const doneVal = p.groups.reduce((a, g) => a + g.items.filter((x) => x.item.done).reduce((b, x) => b + x.val, 0), 0); const stops = p.groups.length;
    return <>
      <div className="hero">
        <div><div className="k">Estimated total</div><Big n={p.total} /></div>
        <div className="meta"><span className="chip">{stops} {stops === 1 ? "stop" : "stops"}</span><span className="chip">{l.items.length} items</span>{doneVal > 0 && <span className="chip green"><Icon name="check" />{money(doneVal)} in cart</span>}{p.unpriced.length > 0 && <span className="chip amber">{p.unpriced.length} unpriced</span>}</div>
        {single && single.total > p.total + 0.5 ? <div className="ribbon"><Icon name="spark" /><span>{money(single.total - p.total)} less than doing it all at {single.store.chain || single.store.name}{stops > 1 ? ` — worth ${stops - 1} extra ${stops - 1 === 1 ? "stop" : "stops"}?` : ""}</span></div>
          : single && stops > 1 ? <div className="ribbon amber"><Icon name="swap" /><span>{single.store.chain} alone is about the same price — check Single Store to skip the extra stops.</span></div> : null}
      </div>
      {p.groups.map((g) => <div className="group" key={g.store.id}><div className="card">
        <div className="storehd"><span className="storemark" style={{ background: storeColor(g.store) }}>{storeInitials(g.store)}</span><div className="body"><div className="t">{g.store.name}</div><div className="s">{g.store.distance != null ? `${g.store.distance} mi · ` : ""}{g.store.address}</div></div><div className="sum"><div className="n">{money(g.sub)}</div><div className="s">{g.items.length} {g.items.length === 1 ? "item" : "items"}</div></div></div>
        {g.items.map(({ item, quote, val }) => <button key={item.id} className="row tap" onClick={() => saveList({ ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) })}>
          <span className={"check" + (item.done ? " on" : "")} aria-hidden="true"><Icon name="check" /></span>
          <span className="body"><span className="t" style={item.done ? { textDecoration: "line-through", color: "var(--label2)" } : undefined}>{item.name}{item.qty > 1 && <span className="val"> ×{item.qty}</span>}</span><span className="s">{quote.product}{quote.size ? ` · ${quote.size}` : ""}{quote.match === "similar" && <> · <span style={{ color: "var(--amber)" }}>substitute</span></>}{quote.promo != null && quote.promo > 0 && quote.promo < (quote.price ?? Infinity) && <> · <span style={{ color: "var(--accent)" }}>on sale</span></>}</span></span>
          <SourceChip q={quote} /><span className="price win">{money(val)}</span>
        </button>)}
      </div></div>)}
      {p.unpriced.length > 0 && <div className="group"><div className="hd"><span>Couldn&apos;t price</span></div><div className="card">{p.unpriced.map((it) => <button key={it.id} className="row tap" onClick={() => setSheet({ kind: "item", id: it.id })}><span className="lead"><Icon name="tag" /></span><span className="body"><span className="t">{it.name}</span><span className="s">No price data in scope — try Online or Out of Radius</span></span><Icon name="chev" /></button>)}</div></div>}
    </>;
  }
  function Single() {
    const l = list!; const p = planSingle(l, activeStores);
    if (!p.n) return <div className="card"><div className="empty"><Icon name="store" /><p>Single-store mode only compares items within your radius. Everything on this list is online or out of radius.</p></div></div>;
    const full = p.ranked.filter((r) => r.covered === r.n); const best = full[0] || p.ranked[0]; const bs = planByStore(l, (it) => storesForScope(it.scope)); const open = openStore || best.store.id;
    return <>
      <div className="hero">
        <div><div className="k">{best.covered === best.n ? "Cheapest one-stop cart" : "Best coverage — no store has everything"}</div><Big n={best.total} /></div>
        <div className="meta"><span className="chip green">{best.store.chain || best.store.name}</span><span className="chip">{best.covered}/{best.n} items</span>{best.similar > 0 && <span className="chip amber"><Icon name="swap" />{best.similar} {best.similar === 1 ? "substitute" : "substitutes"}</span>}{p.others.length > 0 && <span className="chip blue">+{p.others.length} online / out of radius</span>}</div>
        {best.covered === best.n && bs.total < best.total - 0.5 ? <div className="ribbon"><Icon name="plan" /><span>Splitting across {bs.groups.length} stores would save {money(best.total - bs.total)}.</span></div>
          : best.covered === best.n ? <div className="ribbon"><Icon name="check" /><span>One stop is also the cheapest way to shop this list.</span></div>
          : <div className="ribbon amber"><Icon name="swap" /><span>{best.missing.length} {best.missing.length === 1 ? "item isn't" : "items aren't"} carried here. Split by Store covers everything.</span></div>}
      </div>
      <div className="group"><div className="hd"><span>Ranked by cart total</span><span>{full.length} of {p.ranked.length} have it all</span></div>
        {p.ranked.map((r, i) => <div className="card" key={r.store.id} style={{ marginBottom: 8 }}>
          <button className="row tap" onClick={() => setOpenStore(open === r.store.id ? "-" : r.store.id)}><span className={"rank" + (i === 0 ? " gold" : "")}>{i + 1}</span><span className="storemark" style={{ background: storeColor(r.store) }}>{storeInitials(r.store)}</span><span className="body"><span className="t">{r.store.name}</span><span className="s">{r.store.distance != null ? `${r.store.distance} mi · ` : ""}{r.covered}/{r.n} items{r.similar ? ` · ${r.similar} sub${r.similar === 1 ? "" : "s"}` : ""}</span></span><span className="trail"><span className={"price" + (r.covered === r.n ? " win" : "")}>{money(r.total)}</span><Icon name="chev" /></span></button>
          <div className="row" style={{ paddingTop: 0, minHeight: 0, paddingBottom: 12 }}><span className="bar" aria-label={`${r.covered} of ${r.n} items`}><i style={{ width: `${Math.round((100 * r.covered) / r.n)}%` }} /></span></div>
          {open === r.store.id && r.lines.map(({ item, quote, val }) => <div className="row" key={item.id}><span className="body"><span className="t" style={{ fontSize: 15 }}>{item.name}{item.qty > 1 && <span className="val"> ×{item.qty}</span>}</span><span className="s">{quote ? `${quote.product}${quote.size ? ` · ${quote.size}` : ""}` : "Not carried"}{quote?.match === "similar" && <> · <span style={{ color: "var(--amber)" }}>substitute</span></>}</span></span>{quote && <SourceChip q={quote} />}<span className="price" style={{ color: !quote ? "var(--label3)" : quote.match === "similar" ? "var(--amber)" : undefined }}>{quote ? money(val) : "—"}</span></div>)}
        </div>)}
      </div>
    </>;
  }
  function renderStores() {
    const all = radiusStores; const pref = profile.preferredStoreIds; const usingPref = pref.length > 0;
    return <>
      {onboarding && <Steps n={2} label="Choose your stores" />}
      {onboarding && all.length > 0 && <div className="cta"><div className="in"><button className="btn primary block" onClick={() => { setTab("list"); window.scrollTo({ top: 0 }); setTimeout(() => inputRef.current?.focus(), 50); }}>Continue<small>{usingPref ? `${pref.length} stores picked` : `using all ${all.length} stores`}</small><Icon name="chev" /></button></div></div>}
      <div className="group"><div className="hd"><span>Location</span></div><div className="card">
        <button className="row tap" onClick={() => setSheet({ kind: "location" })}><span className="lead"><Icon name="pin" /></span><span className="body"><span className="t">{profile.zip ? `ZIP ${profile.zip}` : "Set ZIP code"}</span><span className="s">{profile.radius} mile radius</span></span><Icon name="chev" /></button>
      </div><p className="ft">{session!.type === "user" ? "Changing the radius saves it as your default." : "Sign in to remember your radius across devices."}</p></div>
      <div className="group"><div className="hd"><span>Stores in range</span>{all.length > 0 && <button className="act" onClick={() => ensureStores(true)}>Refresh</button>}</div>
        {busy ? <div className="card"><div className="status"><span className="spin" /><span>{busy}</span></div></div>
          : !all.length ? <div className="card"><div className="empty"><Icon name="store" /><h3>No stores loaded</h3><p>{profile.zip ? `Find grocery stores near ${profile.zip}.` : "Set your ZIP code first."}</p>{profile.zip && <button className="btn primary" onClick={() => ensureStores(true)}><Icon name="search" />Find Stores</button>}</div></div>
          : <>
            <div className="card"><div className="row"><span className="lead"><Icon name="check" /></span><span className="body"><span className="t">Only my picks</span><span className="s">{usingPref ? `${pref.length} selected · lists split among these` : "Off — every store in range is considered"}</span></span><button className={"toggle" + (usingPref ? " on" : "")} role="switch" aria-checked={usingPref} aria-label="Only my picks" onClick={() => { if (usingPref) saveProfile({ ...profile, preferredStoreIds: [] }); else showToast("Tap stores below to pick them"); }} /></div></div>
            <div className="card">{all.map((s) => { const on = pref.includes(s.id); return <button key={s.id} className="row tap ind" aria-pressed={on} onClick={() => saveProfile({ ...profile, preferredStoreIds: on ? pref.filter((x) => x !== s.id) : [...pref, s.id] })}><span className="storemark" style={{ background: storeColor(s) }}>{storeInitials(s)}</span><span className="body"><span className="t">{s.name}</span><span className="s">{s.distance != null ? `${s.distance} mi · ` : ""}{s.address}{s.krogerLocationId && " · live prices"}</span></span><span className={"check" + (on ? " on" : "")} aria-hidden="true"><Icon name="check" /></span></button>; })}</div>
            <p className="ft">Tap stores to build your preferred set. With none selected, every store in range competes.</p>
          </>}
      </div>
      {outsideStores.length > 0 && <div className="group"><div className="hd"><span>Beyond {profile.radius} mi</span></div><div className="card">{outsideStores.map((s) => <div className="row" key={s.id}><span className="storemark" style={{ background: storeColor(s) }}>{storeInitials(s)}</span><span className="body"><span className="t">{s.name}</span><span className="s">{s.distance != null ? `${s.distance} mi · ` : ""}{s.address}</span></span></div>)}</div></div>}
      <p className="note">Store locations come from Foursquare Places. Missing one? Refresh, or widen the radius.</p>
      {onboarding && all.length > 0 && <div style={{ height: 64 }} />}
    </>;
  }
  function renderSaved() {
    const templates = lists.filter((l) => l.saved); const past = lists.filter((l) => !l.saved && l.status === "done");
    const Row = ({ l, icon, lead, title }: { l: GroceryList; icon: string; lead?: React.CSSProperties; title: string }) => { const t = Object.keys(l.quotes || {}).length ? planTotalFor(l) : null; return <button className="row tap" onClick={() => setSheet({ kind: "savedList", id: l.id })}><span className="lead" style={lead}><Icon name={icon} /></span><span className="body"><span className="t">{title}</span><span className="s">{l.items.length} items · {l.items.slice(0, 3).map((i) => i.name).join(", ")}{l.items.length > 3 ? "…" : ""}</span></span><span className="trail">{t != null && t > 0 && <span className="price">{money(t)}</span>}<Icon name="chev" /></span></button>; };
    return <>
      {session!.type === "guest" && <div className="ribbon blue"><Icon name="person" /><span>Guest lists live only in this browser. <button style={{ color: "inherit", textDecoration: "underline", fontWeight: 700 }} onClick={() => setSheet({ kind: "auth", mode: "up" })}>Create an account</button> to sync them.</span></div>}
      <div className="group"><div className="hd"><span>Saved lists</span>{list!.items.length > 0 && <button className="act" onClick={saveAsTemplate}>Save current</button>}</div>
        {templates.length ? <div className="card">{templates.map((l) => <Row key={l.id} l={l} icon="saved" lead={{ background: "var(--accent-soft)", color: "var(--accent)" }} title={l.name} />)}</div>
          : <div className="card"><div className="empty"><Icon name="saved" /><h3>No saved lists</h3><p>Save your weekly staples once and drop them into any trip with one tap.</p></div></div>}
      </div>
      <div className="group"><div className="hd"><span>Past trips</span></div>
        {past.length ? <div className="card">{past.map((l) => <Row key={l.id} l={l} icon="clock" title={fmtDate(l.finishedAt || l.updatedAt)} />)}</div>
          : <div className="card"><div className="empty"><Icon name="clock" /><p>Finished trips show up here. Tap Finish Trip on the Plan tab when you&apos;re done shopping.</p></div></div>}
      </div>
    </>;
  }

  /* ---------- sheets ---------- */
  function renderSheet() {
    if (!sheet) return null;
    switch (sheet.kind) {
      case "location": return <LocationSheet firstRun={!!sheet.firstRun} profile={profile} isUser={session?.type === "user"} onClose={() => setSheet(null)} onSave={async (zip, radius) => {
        const p = profileRef.current; const changed = zip !== p.zip || radius !== p.radius;
        const next = { ...p, zip, radius }; await saveProfile(next); setSheet(null);
        if (changed || !next.storesCache) { setTab("stores"); setTimeout(() => ensureStores(zip !== p.zip || (!!next.storesCache && radius > next.storesCache.radius)), 0); }
      }} />;
      case "item": { const it = list?.items.find((i) => i.id === sheet.id); if (!it) return null; return <ItemSheet it={it} list={list!} radius={profile.radius} stores={storesForScope} onClose={() => setSheet(null)}
        onSave={(patch) => { saveList({ ...list!, items: list!.items.map((i) => (i.id === it.id ? { ...i, ...patch } : i)) }); setSheet(null); }}
        onRemove={() => { saveList({ ...list!, items: list!.items.filter((i) => i.id !== it.id) }); setSheet(null); showToast("Removed"); }}
        onPriceOne={async (patch) => {
          const l = { ...list!, items: list!.items.map((i) => (i.id === it.id ? { ...i, ...patch } : i)) }; await saveList(l); setSheet(null);
          const p = await ensureStores(); if (!p) return; const item = l.items.find((i) => i.id === it.id)!;
          let stores: Store[] = item.scope === "online" ? ONLINE_STORES : item.scope === "outside" ? (await ensureOutside()) || [] : activeStores;
          if (item.scope === "radius") { const c = p.storesCache!; const all = c.stores.filter((s) => s.distance == null || s.distance <= p.radius); const chosen = all.filter((s) => p.preferredStoreIds.includes(s.id)); stores = chosen.length ? chosen : all; }
          if (!stores.length) { showToast("No stores to check"); return; }
          setBusy(`Pricing ${item.name} at ${stores.length} stores…`);
          try { const got = await api<{ quotes: Record<string, Record<string, Quote>> }>("/api/prices", { items: [{ name: item.name, note: item.note }], stores, zip: p.zip }); const quotes = { ...l.quotes }; for (const k in got.quotes) quotes[k] = { ...(quotes[k] || {}), ...got.quotes[k] }; await saveList({ ...l, quotes }); }
          catch (e) { setErr(e instanceof Error ? e.message : "Pricing failed"); } finally { setBusy(null); }
          setSheet({ kind: "item", id: it.id });
        }} />; }
      case "auth": return <AuthSheet mode={sheet.mode} onClose={() => setSheet(null)} onSwitch={(m) => setSheet({ kind: "auth", mode: m })} onSignedIn={async (s, isUp) => {
        const wasGuest = session?.type === "guest"; const guestProfile = wasGuest ? await LocalStorage.loadProfile() : null; const guestLists = wasGuest ? await LocalStorage.loadLists() : [];
        setSheet(null); setSession(s);
        if (isUp && wasGuest && (guestProfile?.zip || guestLists.length)) {
          // carry guest data forward once the remote adapter is ready
          const rs = remoteStorage(s);
          try { const rp = await rs.loadProfile(); if (guestProfile?.zip && !rp.zip) await rs.saveProfile({ ...rp, ...guestProfile }); for (const l of guestLists) await rs.saveList(l); } catch (e) { console.warn(e); }
          setTimeout(() => loadAccount(rs), 0);
        }
        showToast(isUp ? `Welcome, ${s.name}` : `Signed in as ${s.name}`);
      }} />;
      case "account": return <Sheet title="Account" noDone cancelLabel="Close" onClose={() => setSheet(null)}>
        <div className="group"><div className="card"><div className="row"><span className={"avatar" + (session!.type === "guest" ? " guest" : "")} style={{ width: 44, height: 44, fontSize: 18 }}>{session!.type === "guest" ? <Icon name="person" /> : session!.name.slice(0, 1).toUpperCase()}</span><span className="body"><span className="t">{session!.name}</span><span className="s">{session!.type === "guest" ? "Guest · data stays in this browser" : session!.email || "Signed in · synced lists and settings"}</span></span></div></div></div>
        <div className="group"><div className="card">
          <button className="row tap" onClick={() => setSheet({ kind: "location" })}><span className="lead"><Icon name="pin" /></span><span className="body"><span className="t">Location & radius</span><span className="s">{profile.zip ? `${profile.zip} · ${profile.radius} mi` : "Not set"}</span></span><Icon name="chev" /></button>
          <button className="row tap" onClick={async () => { setSheet(null); const n = await ask("List name", list!.name, "Grocery run"); if (n) saveList({ ...listRef.current!, name: n }); }}><span className="lead"><Icon name="list" /></span><span className="body"><span className="t">Rename current list</span><span className="s">{list!.name}</span></span><Icon name="chev" /></button>
        </div></div>
        {session!.type === "guest" ? <div className="stack"><button className="btn primary block" onClick={() => setSheet({ kind: "auth", mode: "up" })}>Create Account</button><button className="btn tint block" onClick={() => setSheet({ kind: "auth", mode: "in" })}>Sign In</button><p className="note" style={{ textAlign: "center" }}>Creating an account keeps your current list and settings.</p></div>
          : <button className="btn block danger" onClick={signOut}>Sign Out</button>}
      </Sheet>;
      case "savedList": { const l = lists.find((x) => x.id === sheet.id); if (!l) return null; return <Sheet title={l.name} noDone cancelLabel="Close" onClose={() => setSheet(null)}>
        <div className="group"><div className="hd"><span>{l.saved ? "Saved list" : `Trip on ${fmtDate(l.finishedAt || l.updatedAt)}`}</span><span>{l.items.length} items</span></div><div className="card">{l.items.map((i) => <div className="row" key={i.id}><span className="body"><span className="t" style={{ fontSize: 15 }}>{i.name}{i.qty > 1 && <span className="val"> ×{i.qty}</span>}</span>{i.note && <span className="s">{i.note}</span>}</span>{i.scope !== "radius" && <span className={"chip " + (i.scope === "online" ? "blue" : "amber")}>{i.scope === "online" ? "Online" : "Out of radius"}</span>}</div>)}</div></div>
        <div className="stack"><button className="btn primary block" onClick={() => useList(l, "add")}><Icon name="plus" />Add to Current List</button><button className="btn block" onClick={() => useList(l, "replace")}><Icon name="swap" />Replace Current List</button><button className="btn danger block" onClick={async () => { setSheet(null); if (!(await confirm("Delete List", `Delete "${l.name}"? This can't be undone.`, "Delete", true))) return; setLists((all) => all.filter((x) => x.id !== l.id)); try { await storage?.deleteList(l.id); } catch { /* ignore */ } showToast("Deleted"); }}><Icon name="trash" />Delete</button></div>
      </Sheet>; }
      case "ask": return <AskSheet s={sheet} onClose={() => { sheet.resolve(null); setSheet(null); }} onSave={(v) => { setSheet(null); sheet.resolve(v); }} />;
      case "confirm": return <Sheet title={sheet.title} noDone onClose={() => { sheet.resolve(false); setSheet(null); }}><p className="note" style={{ fontSize: 15, color: "var(--label)" }}>{sheet.message}</p><button className={"btn block " + (sheet.danger ? "danger" : "primary")} onClick={() => { setSheet(null); sheet.resolve(true); }}>{sheet.label}</button></Sheet>;
    }
  }
}

/* ======================= sub-components ======================= */
function Welcome({ onGuest, onAuth, sheet }: { onGuest: () => void; onAuth: (m: "in" | "up") => void; sheet: React.ReactNode }) {
  const auth = supabaseConfigured();
  return <div className="welcome">
    <div className="logo"><Icon name="cart" /></div>
    <div className="stack" style={{ gap: 10 }}><h1>Cartography</h1><p className="lede">Write one grocery list. Cartography splits it across the cheapest stores near you — or finds the single store where the whole cart costs least.</p></div>
    <ul>
      <li><Icon name="pin" /><div><b>Real stores around your ZIP</b>Pick a radius (10 miles to start) or hand-pick your favorite stores.</div></li>
      <li><Icon name="tag" /><div><b>Every item, priced everywhere</b>Live shelf prices where stores publish them, estimates where they don&apos;t — always labeled.</div></li>
      <li><Icon name="saved" /><div><b>Lists that come back</b>Reuse saved lists and see past trips with an account.</div></li>
    </ul>
    <div className="stack">
      <button className="btn primary block" onClick={() => onAuth("in")} disabled={!auth}>Sign In</button>
      <button className="btn tint block" onClick={() => onAuth("up")} disabled={!auth}>Create Account</button>
      <button className="btn plain block" onClick={onGuest}>Continue as Guest</button>
    </div>
    <p className="note" style={{ padding: 0, textAlign: "center" }}>{auth ? "Guest lists stay on this device." : "Accounts are off until Supabase is configured — guest mode works now."}</p>
    {sheet}
  </div>;
}

function LocationSheet({ firstRun, profile, isUser, onClose, onSave }: { firstRun: boolean; profile: Profile; isUser: boolean; onClose: () => void; onSave: (zip: string, radius: number) => Promise<void> }) {
  const [zip, setZip] = useState(profile.zip); const [radius, setRadius] = useState(profile.radius); const [msg, setMsg] = useState("");
  const setR = (r: number) => setRadius(clamp(r, 1, 50));
  return <Sheet title="Location" cancelLabel={firstRun ? "Later" : "Cancel"} doneLabel="Save" onClose={onClose} onDone={async () => { if (!/^\d{5}$/.test(zip.trim())) { setMsg("Enter a 5-digit ZIP code."); return false; } await onSave(zip.trim(), radius); }}>
    {firstRun && <div className="steps"><span className="dots"><i className="on" /><i /><i /></span><span>Step 1 of 3 · Where do you shop?</span></div>}
    <div className="group"><div className="field-lbl">ZIP code</div><input id="zipIn" className="textin num" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={5} placeholder="92019" value={zip} onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setMsg(""); }} aria-label="ZIP code" autoFocus />{msg && <div className="err">{msg}</div>}<p className="note">Stores are found around this ZIP&apos;s center.</p></div>
    <div className="group"><div className="field-lbl">Radius</div><div className="card"><div className="row"><span className="body"><span className="t">Distance</span><span className="s">Any grocery store this far is considered</span></span><span className="stepper"><button type="button" aria-label="Smaller radius" onClick={() => setR(radius - (radius > 15 ? 5 : 1))}><Icon name="minus" /></button><span className="n num">{radius} mi</span><button type="button" aria-label="Larger radius" onClick={() => setR(radius + (radius >= 15 ? 5 : 1))}><Icon name="plus" /></button></span></div></div>
      <div className="seg">{[5, 10, 15, 25].map((r) => <button key={r} type="button" className={radius === r ? "on" : ""} onClick={() => setR(r)}>{r} mi</button>)}</div>
      <p className="note">{isUser ? "Saved as your default radius." : "Default is 10 miles. An account remembers your choice."}</p></div>
  </Sheet>;
}

function ItemSheet({ it, list, radius, stores, onClose, onSave, onRemove, onPriceOne }: { it: Item; list: GroceryList; radius: number; stores: (s: Scope) => Store[]; onClose: () => void; onSave: (p: Partial<Item>) => void; onRemove: () => void; onPriceOne: (p: Partial<Item>) => void }) {
  const [qty, setQty] = useState(it.qty || 1); const [note, setNote] = useState(it.note || ""); const [sc, setSc] = useState<Scope>(it.scope);
  const q = itemQuotes(list, it); const rows = stores(it.scope).map((s) => ({ s, x: q[s.id] })).filter((r) => r.x).sort((a, b) => (a.x.price ?? 1e9) - (b.x.price ?? 1e9));
  const patch = { qty, note: note.trim(), scope: sc };
  const ScopeRow = ({ id, label, ic }: { id: Scope; label: string; ic: string }) => <button className="row tap" onClick={() => setSc(id)}><span className="lead"><Icon name={ic} /></span><span className="body"><span className="t">{label}</span></span><span className={"check" + (sc === id ? " on" : "")} aria-hidden="true"><Icon name="check" /></span></button>;
  return <Sheet title={it.name} onClose={onClose} onDone={() => onSave(patch)}>
    <div className="group"><div className="card">
      <div className="row"><span className="body"><span className="t">Quantity</span></span><span className="stepper"><button type="button" aria-label="Fewer" onClick={() => setQty(clamp(qty - 1, 1, 99))}><Icon name="minus" /></button><span className="n num">{qty}</span><button type="button" aria-label="More" onClick={() => setQty(clamp(qty + 1, 1, 99))}><Icon name="plus" /></button></span></div>
      <div className="row"><span className="body"><span className="t">Note</span></span><input className="field" type="text" placeholder="brand, size, organic…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" /></div>
    </div></div>
    <div className="group"><div className="hd"><span>Where to look</span></div><div className="card"><ScopeRow id="radius" label={`Within ${radius} mi`} ic="pin" /><ScopeRow id="online" label="Online" ic="globe" /><ScopeRow id="outside" label="Out of radius" ic="far" /></div></div>
    <div className="group"><div className="hd"><span>Prices</span>{rows.length > 0 && <span>{rows.length} {rows.length === 1 ? "store" : "stores"}</span>}</div>
      {rows.length ? <div className="card">{rows.map((r, i) => <div className="row" key={r.s.id}><span className="storemark" style={{ background: storeColor(r.s) }}>{storeInitials(r.s)}</span><span className="body"><span className="t">{r.s.name}</span><span className="s">{r.x.match === "none" ? "No price data" : <>{r.x.product}{r.x.size ? ` · ${r.x.size}` : ""}{r.x.match === "similar" && <> · <span style={{ color: "var(--amber)" }}>substitute</span></>}</>}</span></span>{r.x.source === "kroger" ? <span className="chip green">live</span> : r.x.source === "estimate" ? <span className="chip amber">est.</span> : null}<span className={"price" + (i === 0 && r.x.price != null ? " win" : "")}>{r.x.price != null ? money(r.x.price) : "—"}</span></div>)}</div>
        : <div className="card"><div className="empty" style={{ padding: 20 }}><p>No prices yet.</p><button className="btn sm tint" onClick={() => onPriceOne(patch)}><Icon name="spark" />Check prices{sc === "online" ? " online" : sc === "outside" ? ` beyond ${radius} mi` : ""}</button></div></div>}
    </div>
    <button className="btn danger block" onClick={onRemove}><Icon name="trash" />Remove from list</button>
  </Sheet>;
}

function AuthSheet({ mode, onClose, onSwitch, onSignedIn }: { mode: "in" | "up"; onClose: () => void; onSwitch: (m: "in" | "up") => void; onSignedIn: (s: Session, isUp: boolean) => void }) {
  const isUp = mode === "up";
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [name, setName] = useState(""); const [msg, setMsg] = useState("");
  async function submit() {
    const sb = supabase(); if (!sb) { setMsg("Accounts aren't configured yet."); return false; }
    if (!/\S+@\S+\.\S+/.test(email)) { setMsg("Enter a valid email address."); return false; }
    if (pw.length < 6) { setMsg("Password must be at least 6 characters."); return false; }
    if (isUp) {
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { display_name: name.trim() || email.split("@")[0] } } });
      if (error) { setMsg(error.message); return false; }
      if (!data.session) { setMsg("Check your email to confirm your account, then sign in."); return false; }
      onSignedIn({ type: "user", id: data.user!.id, name: name.trim() || email.split("@")[0], email }, true);
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) { setMsg(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message); return false; }
      const u = data.user; onSignedIn({ type: "user", id: u.id, name: (u.user_metadata?.display_name as string) || email.split("@")[0], email }, false);
    }
  }
  return <Sheet title={isUp ? "Create Account" : "Sign In"} doneLabel={isUp ? "Create" : "Sign In"} onClose={onClose} onDone={submit}>
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="stack" style={{ gap: 18 }}>
      {isUp && <div className="group"><div className="field-lbl">Name</div><input className="textin" type="text" autoComplete="nickname" placeholder="Camden" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus /></div>}
      <div className="group"><div className="field-lbl">Email</div><input className="textin" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setMsg(""); }} aria-label="Email" autoFocus={!isUp} /></div>
      <div className="group"><div className="field-lbl">Password</div><input className="textin" type="password" autoComplete={isUp ? "new-password" : "current-password"} placeholder="••••••••" value={pw} onChange={(e) => { setPw(e.target.value); setMsg(""); }} aria-label="Password" /><p className="note">{isUp ? "At least 6 characters." : ""}</p></div>
      {msg && <div className="err">{msg}</div>}
      <button type="submit" hidden />
    </form>
    <div className="auth-alt"><button className="btn plain" type="button" onClick={() => onSwitch(isUp ? "in" : "up")}>{isUp ? "Have an account? Sign in" : "New here? Create an account"}</button></div>
  </Sheet>;
}

function AskSheet({ s, onClose, onSave }: { s: { title: string; value: string; placeholder?: string }; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(s.value);
  return <Sheet title={s.title} doneLabel="Save" onClose={onClose} onDone={() => { if (!v.trim()) return false; onSave(v.trim()); }}>
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); }}><div className="group"><input className="textin" type="text" value={v} placeholder={s.placeholder} maxLength={48} onChange={(e) => setV(e.target.value)} aria-label={s.title} autoFocus /></div></form>
  </Sheet>;
}
