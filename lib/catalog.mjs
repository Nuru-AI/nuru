// The catalog Nuru plans over. Any marketplace that publishes its products as a list of {id, name, price, description,
// example input, input options} can feed Nuru; this file reads Sippar's free catalog and turns it into the sheet the
// planner reads and the shelf the checker enforces. Nothing here costs anything.
import { plannerSheet, shelfFrom, RESULT_SHAPES } from "./planner.mjs";

export const CATALOG_URL = process.env.CATALOG_URL || "https://sippar.network/api/sippar/sell/catalog";
export const SELL = process.env.SIPPAR_SELL_URL || "https://sippar.network/api/sippar/sell";

/** Products the planner may see. Per-model image and video products and per-chain pages are left out of the sheet to
 *  keep it readable (the generic image, video-search and chain-state entries stay); planners of planners stay out. */
export function defaultFilter(row) {
  const id = row.id || "";
  if (id.startsWith("image-") && id !== "image-generation") return false;
  if (id.startsWith("video-") && id !== "video-search") return false;
  if (id.endsWith("-chain-state")) return false;
  if (["workflow-planner", "competitor-synthesis"].includes(id)) return false;
  return true;
}

/** One catalog row as the planner sees it. `id` is the shelf id (the name the result shapes are recorded under);
 *  `sellId` is the id the sell door answers to. */
export function sheetProduct(row) {
  const shelfId = row.antseedModels?.[0]?.id || row.id;
  const price = typeof row.priceUSD === "number" ? row.priceUSD : typeof row.priceFrom === "number" ? row.priceFrom : undefined;
  if (price === undefined) return null;
  return {
    id: shelfId, sellId: row.id, name: row.name || row.id, priceUSD: price,
    priceFrom: row.priceFrom === true || typeof row.priceUSD !== "number",
    description: row.description || "", input: row.input || {}, inputOptions: row.inputOptions || [],
    health: typeof row.health === "string" ? row.health : row.health?.status, url: `${SELL}/${row.id}`,
  };
}

export async function loadCatalog({ filter = defaultFilter, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(CATALOG_URL, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`catalog: ${r.status}`);
  const d = await r.json();
  const rows = d.products || d.data?.products || (Array.isArray(d) ? d : []);
  const products = rows.filter(filter).map(sheetProduct).filter(Boolean);
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  return {
    products, byId,
    sheet: plannerSheet(products),
    shelf: shelfFrom(products),
    readable: products.filter((p) => RESULT_SHAPES[p.id]).length,
  };
}
