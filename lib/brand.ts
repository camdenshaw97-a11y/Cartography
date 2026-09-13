import type { Store } from "./types";
import { keyOf } from "./util";

export const BRAND_COLORS: [string, string][] = [["walmart","#0F5BCB"],["target","#CC0000"],["costco","#E31837"],["vons","#D4202A"],["ralphs","#1D4FA3"],["albertsons","#0A5AA8"],["safeway","#D4202A"],["kroger","#0B4FA3"],["trader joe","#C8102E"],["whole foods","#00674B"],["sprouts","#4C8B2F"],["smart & final","#D71920"],["smart and final","#D71920"],["grocery outlet","#E2231A"],["stater bros","#C8102E"],["food 4 less","#E4002B"],["aldi","#0A3E99"],["sam's club","#0067A0"],["sams club","#0067A0"],["winco","#003F87"],["99 ranch","#D32027"],["h mart","#D71921"],["northgate","#E4212C"],["cardenas","#1A9E4C"],["el super","#D6001C"],["vallarta","#E21F26"],["food lion","#00529B"],["publix","#3C8E3C"],["heb","#E31837"],["h-e-b","#E31837"],["wegmans","#8B1C1F"],["giant","#673AB7"],["stop & shop","#7A1FA2"],["meijer","#D31F2A"],["hy-vee","#D8262C"],["fred meyer","#004B8D"],["qfc","#C41230"],["fry's","#B7202E"],["king soopers","#0B4FA3"],["harris teeter","#A6192E"],["shoprite","#F26522"],["lidl","#0050AA"],["gelson","#1C3F7A"],["pavilions","#A8232D"],["bristol farms","#1A2B4C"],["erewhon","#1F1F1F"],["lazy acres","#4C8B2F"],["mother's market","#4E9A3F"],["natural grocers","#F58220"],["dollar general","#F5B500"],["family dollar","#E4002B"],["big lots","#F47A20"],["amazon","#FF9900"],["instacart","#0AAD0A"],["walmart.com","#0F5BCB"],["target.com","#CC0000"]];
const STORE_COLORS = ["#0A6EE6","#2F6FDB","#B8481C","#7A3FBF","#B86E00","#0E8C8C","#C9296B","#4E6B1F","#8A4B2F","#3A5CA8","#A03030","#2A7F62"];
export function storeColor(store: Pick<Store,"chain"|"name">): string {
  const n = keyOf(store.chain || store.name); const hit = BRAND_COLORS.find(([k]) => n.includes(k)); if (hit) return hit[1];
  let h = 0; for (const c of (store.chain || store.name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return STORE_COLORS[h % STORE_COLORS.length];
}
export function storeInitials(store: Pick<Store,"chain"|"name">): string {
  const w = (store.chain || store.name).replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || "?").slice(0, 2)).toUpperCase();
}
