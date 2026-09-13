export const keyOf = (s: string) => String(s || "").trim().toLowerCase();
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const money = (n: number | null | undefined) => (n == null || isNaN(n) ? "—" : "$" + Number(n).toFixed(2));
export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export function fmtDate(ts: number) {
  const d = new Date(ts); const now = new Date(); const sameY = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameY ? {} : { year: "numeric" }) });
}
export function ls<T>(k: string): T | null;
export function ls<T>(k: string, v: T | null): void;
export function ls<T>(k: string, v?: T | null): T | null | void {
  try {
    if (v === undefined) { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : null; }
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  } catch { return null; }
}
