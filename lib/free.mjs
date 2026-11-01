// Free public data sources Nuru calls directly, at no charge, next to the paid catalog. Each one's terms were read
// before it was added (Sippar docs/research/2026-11-01_NURU_FREE_API_ACCESS.md §8), and each one's conditions are
// encoded here, not described: a User-Agent that names Nuru, a gap between calls to the same host, a byte and time cap
// on every answer, the endpoints the terms allow and no others, and the credit line each source asks for.
//
// Every adapter turns the source's answer into items with a `text` field written by code from the source's own values,
// so a number in a brief is always one the source returned, quoted word for word. Nothing here costs anything.

export const FREE_SOURCES_ON = process.env.FREE_SOURCES === "on";
export const FREE_CALLS_PER_RUN = Number(process.env.FREE_CALLS_PER_RUN || 10);
export const FREE_FOR_EACH_MAX = Number(process.env.FREE_FOR_EACH_MAX || 5);
const MAX_BYTES = Number(process.env.FREE_MAX_BYTES || 400_000);
const TIMEOUT_MS = Number(process.env.FREE_TIMEOUT_MS || 15_000);
const MAX_ITEMS = 10;
const TEXT_MAX = 3000;

// SEC and Open Library ask for a contact email in the User-Agent; SEC refuses a call without one (measured
// 2026-11-01: 403 "Undeclared Automated Tool"). Sources that need an email stay off until FREE_API_CONTACT is set.
const CONTACT = (process.env.FREE_API_CONTACT || "").trim();
const HAS_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(CONTACT);
// SEC refuses a User-Agent that also carries a GitHub link (measured 2026-11-01), so with an email it is site plus email.
export const USER_AGENT = HAS_EMAIL ? `Nuru/1.0 (+https://agent.sippar.network; ${CONTACT})` : "Nuru/1.0 (+https://agent.sippar.network; https://github.com/Nuru-AI/nuru)";

const enc = encodeURIComponent;
const clip = (s, n = TEXT_MAX) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const limit = (v, d = 5) => Math.max(1, Math.min(MAX_ITEMS, Number.parseInt(v, 10) || d));
const words = (q) => clip(q, 200);
const ymd = (d) => d.toISOString().slice(0, 10);

/**
 * The free sources, as catalog rows. `id` starts with "free-"; the words in each id ("openfda", "coingecko",
 * "defillama", "sec-edgar") are the ones the page matches to show its health and market notices.
 */
export const FREE_SOURCES = [
  {
    id: "free-openalex-works", topic: "research", name: "OpenAlex scholarly works (free)", host: "api.openalex.org", gapMs: 150,
    credit: "OpenAlex (openalex.org), CC0",
    description: "Scholarly papers, books and datasets matching keywords: title, year, venue, citation count and DOI link. Free. Called directly by Nuru, not sold.",
    input: { query: "agent payments" }, inputOptions: [{ field: "limit", description: "How many works, 1 to 10." }],
    url: (i) => `https://api.openalex.org/works?search=${enc(words(i.query))}&per_page=${limit(i.limit)}&select=id,doi,display_name,publication_year,cited_by_count,primary_location`,
    items: (d) => (d.results || []).map((w) => {
      const venue = w.primary_location?.source?.display_name || "";
      return { title: clip(w.display_name, 400), year: w.publication_year ?? null, venue, cited_by: w.cited_by_count ?? null, url: w.doi || w.id,
        text: clip(`${w.display_name} (${w.publication_year ?? "year not given"})${venue ? `, ${venue}` : ""}. Cited ${w.cited_by_count ?? 0} times according to OpenAlex.`) };
    }),
  },
  {
    id: "free-crossref-works", topic: "research", name: "Crossref publication records (free)", host: "api.crossref.org", gapMs: 150,
    credit: "Crossref (crossref.org) metadata",
    description: "Journal articles, preprints and books matching keywords: title, type, year, venue and DOI link. Free. Called directly by Nuru, not sold.",
    input: { query: "agent payments" }, inputOptions: [{ field: "limit", description: "How many records, 1 to 10." }],
    url: (i) => `https://api.crossref.org/works?query=${enc(words(i.query))}&rows=${limit(i.limit)}&select=DOI,title,published,container-title,URL,type`,
    items: (d) => (d.message?.items || []).map((w) => {
      const title = stripTags(Array.isArray(w.title) ? w.title[0] : w.title);
      const year = w.published?.["date-parts"]?.[0]?.[0] ?? null;
      const venue = stripTags(Array.isArray(w["container-title"]) ? w["container-title"][0] || "" : "");
      return { title: clip(title, 400), type: w.type || "", year, venue, url: w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : ""),
        text: clip(`${title} (${w.type || "record"}, ${year ?? "year not given"})${venue ? `, ${venue}` : ""}.`) };
    }),
  },
  {
    id: "free-arxiv-papers", topic: "research", name: "arXiv preprints (free)", host: "export.arxiv.org", gapMs: 3000,
    credit: "arXiv (arxiv.org) metadata, CC0; papers linked, never copied",
    description: "Preprints on arXiv matching all the keywords: title, authors, date, abstract and a link to the paper on arXiv. Free. Called directly by Nuru, not sold.",
    input: { query: "agent payments" }, inputOptions: [{ field: "limit", description: "How many papers, 1 to 10." }],
    format: "xml",
    url: (i) => `https://export.arxiv.org/api/query?search_query=${words(i.query).split(/\s+/).filter(Boolean).map((w) => `all:${enc(w)}`).join("+AND+")}&max_results=${limit(i.limit)}&sortBy=relevance`,
    items: (xml) => [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
      const tag = (t) => stripTags((new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(e) || [])[1] || "");
      const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => stripTags(m[1]).trim());
      const title = clip(tag("title"), 400), published = tag("published").slice(0, 10);
      const url = (/<link href="([^"]+)" rel="alternate"/.exec(e) || [])[1] || tag("id");
      return { title, authors: authors.slice(0, 6).join(", "), published, url, summary: clip(tag("summary")),
        text: clip(`${title}. ${authors.slice(0, 6).join(", ")}${authors.length > 6 ? " and others" : ""}, ${published}. ${clip(tag("summary"))}`) };
    }),
  },
  {
    id: "free-sec-edgar-search", topic: "company", name: "SEC EDGAR full-text search (free)", host: "efts.sec.gov", gapMs: 150, needsEmail: true,
    credit: "U.S. Securities and Exchange Commission, EDGAR",
    description: "US company filings whose text contains an exact phrase: company, form type, filing date and a link to the company filing list. Free. Called directly by Nuru, not sold.",
    input: { query: "stablecoin" }, inputOptions: [{ field: "limit", description: "How many filings, 1 to 10." }],
    url: (i) => `https://efts.sec.gov/LATEST/search-index?q=${enc(`"${words(i.query).replace(/"/g, "")}"`)}`,
    items: (d, i) => (d.hits?.hits || []).slice(0, limit(i.limit)).map((h) => {
      const s = h._source || {};
      const company = clip((s.display_names || [])[0] || "", 200), cik = (s.ciks || [])[0] || "";
      return { company, form: s.form || "", filed: s.file_date || "", url: cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}` : "https://www.sec.gov/edgar/search/",
        text: clip(`${company} filed a ${s.form || "filing"} on ${s.file_date || "an unstated date"} whose text matches the search.`) };
    }),
  },
  {
    id: "free-openfda-drug-recalls", topic: "health", name: "FDA drug recall reports (openFDA, free)", host: "api.fda.gov", gapMs: 300,
    credit: "Data provided by the U.S. Food and Drug Administration (open.fda.gov)",
    description: "FDA drug recall (enforcement) reports whose product description names a drug: the firm, classification, status, reason and report date. FDA data is incomplete, so an empty answer means no matching report was found, not that none exist. Free. Called directly by Nuru, not sold.",
    input: { query: "metformin" }, inputOptions: [{ field: "limit", description: "How many reports, 1 to 10." }],
    emptyStatus: 404,
    url: (i) => `https://api.fda.gov/drug/enforcement.json?search=product_description:${enc(`"${words(i.query).replace(/"/g, "")}"`)}&limit=${limit(i.limit)}&sort=report_date:desc`,
    items: (d) => (d.results || []).map((r) => ({
      firm: clip(r.recalling_firm, 200), classification: r.classification || "", status: r.status || "", reported: r.report_date || "",
      reason: clip(r.reason_for_recall, 600), product: clip(r.product_description, 600), url: "https://www.accessdata.fda.gov/scripts/ires/index.cfm",
      text: clip(`FDA recall report ${r.recall_number || ""} dated ${r.report_date || "not given"}: ${r.recalling_firm || "a firm"}, ${r.classification || "class not given"}, status ${r.status || "not given"}. Product: ${r.product_description || ""}. Reason: ${r.reason_for_recall || ""}`),
    })),
  },
  {
    id: "free-usgs-earthquakes", topic: "data", name: "USGS earthquakes (free)", host: "earthquake.usgs.gov", gapMs: 150,
    credit: "Credit: U.S. Geological Survey",
    description: "Recent earthquakes worldwide from the USGS catalog, newest first: magnitude, place, time and a link to each event page. Free. Called directly by Nuru, not sold.",
    input: { days: 7, minmagnitude: 5 }, inputOptions: [{ field: "limit", description: "How many events, 1 to 10." }],
    url: (i) => {
      const days = Math.max(1, Math.min(30, Number(i.days) || 7)), m = Math.max(0, Math.min(9, Number(i.minmagnitude) || 4.5));
      return `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${ymd(new Date(Date.now() - days * 864e5))}&minmagnitude=${m}&limit=${limit(i.limit)}&orderby=time`;
    },
    items: (d) => (d.features || []).map((f) => {
      const p = f.properties || {}, when = p.time ? new Date(p.time).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
      return { magnitude: p.mag ?? null, place: clip(p.place, 200), time: when, url: p.url || "",
        text: clip(`Magnitude ${p.mag} earthquake, ${p.place}, at ${when} (USGS).`) };
    }),
  },
  {
    id: "free-nasa-power-daily", topic: "data", name: "NASA POWER daily weather and solar data (free)", host: "power.larc.nasa.gov", gapMs: 500,
    credit: "Data from NASA Langley Research Center's POWER project",
    description: "Daily temperature (T2M, degrees C) and rainfall (PRECTOTCORR, mm a day) for a latitude and longitude over a date range of up to 31 days, from satellite and model data. Free. Called directly by Nuru, not sold.",
    input: { latitude: 32.08, longitude: 34.78, start: "20261001", end: "20261007" }, inputOptions: [],
    url: (i) => {
      const d8 = (v) => (/^\d{8}$/.test(String(v)) ? String(v) : null);
      const lat = Math.max(-90, Math.min(90, Number(i.latitude))), lon = Math.max(-180, Math.min(180, Number(i.longitude)));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !d8(i.start) || !d8(i.end)) throw new Error("NASA POWER needs latitude, longitude, start and end (YYYYMMDD)");
      return `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,PRECTOTCORR&community=RE&longitude=${lon}&latitude=${lat}&start=${i.start}&end=${i.end}&format=JSON`;
    },
    items: (d, i) => {
      const t = d.properties?.parameter?.T2M || {}, r = d.properties?.parameter?.PRECTOTCORR || {};
      return Object.keys(t).slice(0, 31).map((k) => {
        const date = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
        return { date, t2m: t[k], rain_mm: r[k] ?? null, url: "https://power.larc.nasa.gov/",
          text: `NASA POWER at ${i.latitude}, ${i.longitude} on ${date}: mean temperature ${t[k]} C, rainfall ${r[k]} mm.` };
      });
    },
  },
  {
    id: "free-worldbank-indicator", topic: "data", name: "World Bank indicators (free)", host: "api.worldbank.org", gapMs: 150,
    credit: "World Bank Open Data, CC BY 4.0",
    description: "One World Bank indicator for one country by year, newest first, for example GDP (NY.GDP.MKTP.CD), population (SP.POP.TOTL) or inflation (FP.CPI.TOTL.ZG). Country is a 2 or 3 letter code. Free. Called directly by Nuru, not sold.",
    input: { country: "IL", indicator: "NY.GDP.MKTP.CD" }, inputOptions: [{ field: "limit", description: "How many years, 1 to 10." }],
    url: (i) => {
      const c = String(i.country || "").toUpperCase(), ind = String(i.indicator || "").toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(c) || !/^[A-Z0-9.]{3,40}$/.test(ind)) throw new Error("World Bank needs a 2 or 3 letter country code and an indicator code");
      return `https://api.worldbank.org/v2/country/${c}/indicator/${ind}?format=json&per_page=${limit(i.limit)}`;
    },
    items: (d) => (Array.isArray(d) && Array.isArray(d[1]) ? d[1] : []).filter((r) => r.value != null).map((r) => ({
      country: r.country?.value || "", indicator: r.indicator?.value || "", year: r.date || "", value: r.value,
      url: `https://data.worldbank.org/indicator/${r.indicator?.id || ""}?locations=${r.country?.id || ""}`,
      text: `${r.indicator?.value}, ${r.country?.value}, ${r.date}: ${r.value} (World Bank).`,
    })),
  },
  {
    id: "free-gbif-species", topic: "data", name: "GBIF species names (free)", host: "api.gbif.org", gapMs: 150,
    credit: "GBIF.org, with each dataset's own licence",
    description: "Species and other taxa matching a name: scientific name, rank, kingdom, family and a link to the GBIF species page. Free. Called directly by Nuru, not sold.",
    input: { query: "quercus" }, inputOptions: [{ field: "limit", description: "How many names, 1 to 10." }],
    url: (i) => `https://api.gbif.org/v1/species/search?q=${enc(words(i.query))}&limit=${limit(i.limit)}`,
    items: (d) => (d.results || []).map((s) => ({
      name: clip(s.scientificName, 200), rank: s.rank || "", kingdom: s.kingdom || "", family: s.family || "", url: `https://www.gbif.org/species/${s.nubKey || s.key}`,
      text: clip(`${s.scientificName}: rank ${s.rank || "not given"}, kingdom ${s.kingdom || "not given"}, family ${s.family || "not given"} (GBIF).`),
    })),
  },
  {
    id: "free-wikipedia-search", topic: "reference", name: "Wikipedia search (free)", host: "en.wikipedia.org", gapMs: 200,
    credit: "Wikipedia, CC BY-SA 4.0",
    description: "English Wikipedia articles matching keywords: title, a short matching passage and the article link. Free. Called directly by Nuru, not sold.",
    input: { query: "stablecoin" }, inputOptions: [{ field: "limit", description: "How many articles, 1 to 10." }],
    url: (i) => `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(words(i.query))}&format=json&srlimit=${limit(i.limit)}&utf8=1`,
    items: (d) => (d.query?.search || []).map((a) => ({
      title: a.title, snippet: clip(stripTags(a.snippet), 600), url: `https://en.wikipedia.org/wiki/${enc(String(a.title).replace(/ /g, "_"))}`,
      text: clip(`${a.title}: ${stripTags(a.snippet)}`),
    })),
  },
  {
    id: "free-npm-packages", topic: "reference", name: "npm package search (free)", host: "registry.npmjs.org", gapMs: 200,
    credit: "npm registry",
    description: "JavaScript packages on npm matching keywords: name, version, description, weekly downloads and the package page. Package metadata only. Free. Called directly by Nuru, not sold.",
    input: { query: "x402" }, inputOptions: [{ field: "limit", description: "How many packages, 1 to 10." }],
    url: (i) => `https://registry.npmjs.org/-/v1/search?text=${enc(words(i.query))}&size=${limit(i.limit)}`,
    // Never the maintainers' or publishers' emails: package metadata only.
    items: (d) => (d.objects || []).map((o) => {
      const p = o.package || {}, weekly = o.downloads?.weekly ?? null;
      return { name: p.name, version: p.version || "", description: clip(p.description, 400), weekly_downloads: weekly, updated: o.updated || p.date || "", url: `https://www.npmjs.com/package/${p.name}`,
        text: clip(`npm package ${p.name} ${p.version || ""}: ${p.description || "no description"}.${weekly != null ? ` ${weekly} downloads last week.` : ""}`) };
    }),
  },
  {
    id: "free-openlibrary-books", topic: "reference", name: "Open Library books (free)", host: "openlibrary.org", gapMs: 1100,
    credit: "Open Library (Internet Archive)",
    description: "Books matching keywords: title, authors, first publication year, number of editions and the Open Library page. Free. Called directly by Nuru, not sold.",
    input: { query: "agents" }, inputOptions: [{ field: "limit", description: "How many books, 1 to 10." }],
    url: (i) => `https://openlibrary.org/search.json?q=${enc(words(i.query))}&limit=${limit(i.limit)}&fields=key,title,author_name,first_publish_year,edition_count`,
    items: (d) => (d.docs || []).map((b) => {
      const authors = (b.author_name || []).slice(0, 4).join(", ");
      return { title: clip(b.title, 300), authors, first_published: b.first_publish_year ?? null, editions: b.edition_count ?? null, url: `https://openlibrary.org${b.key}`,
        text: clip(`${b.title}${authors ? ` by ${authors}` : ""}, first published ${b.first_publish_year ?? "year not given"}, ${b.edition_count ?? "unknown number of"} editions (Open Library).`) };
    }),
  },
  {
    id: "free-coingecko-markets", topic: "crypto", name: "CoinGecko coin prices (free)", host: "api.coingecko.com", gapMs: 6500,
    credit: "Data from CoinGecko",
    description: "Live price, market cap, 24-hour change and last update time for named coins by CoinGecko id (for example bitcoin, ethereum, solana), comma separated. Free. Called directly by Nuru, not sold.",
    input: { ids: "bitcoin,ethereum" }, inputOptions: [],
    url: (i) => {
      const ids = String(i.ids || "").toLowerCase().split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]{1,60}$/.test(s)).slice(0, 10);
      if (!ids.length) throw new Error("CoinGecko needs coin ids, for example bitcoin,ethereum");
      return `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(",")}`;
    },
    items: (d) => (Array.isArray(d) ? d : []).map((c) => ({
      name: c.name, symbol: String(c.symbol || "").toUpperCase(), price_usd: c.current_price, market_cap_usd: c.market_cap, change_24h_pct: c.price_change_percentage_24h, updated: c.last_updated || "",
      url: `https://www.coingecko.com/en/coins/${c.id}`,
      text: `${c.name} (${String(c.symbol || "").toUpperCase()}) on CoinGecko at ${c.last_updated}: price ${c.current_price} USD, market cap ${c.market_cap} USD, 24-hour change ${c.price_change_percentage_24h} percent.`,
    })),
  },
  {
    id: "free-defillama-tvl", topic: "crypto", name: "DefiLlama protocol TVL (free)", host: "api.llama.fi", gapMs: 500,
    credit: "Data from DefiLlama",
    description: "The current total value locked (TVL, USD) of one DeFi protocol by its DefiLlama slug, for example aave, uniswap, lido. One number per call. Free. Called directly by Nuru, not sold.",
    input: { protocol: "aave" }, inputOptions: [],
    url: (i) => {
      const slug = String(i.protocol || "").toLowerCase().trim();
      if (!/^[a-z0-9.-]{2,60}$/.test(slug)) throw new Error("DefiLlama needs a protocol slug, for example aave");
      return `https://api.llama.fi/tvl/${slug}`;
    },
    items: (d, i, at) => (typeof d === "number" && Number.isFinite(d) ? [{
      protocol: String(i.protocol).toLowerCase(), tvl_usd: Math.round(d), read_at: at, url: `https://defillama.com/protocol/${String(i.protocol).toLowerCase()}`,
      text: `${String(i.protocol).toLowerCase()} total value locked on DefiLlama at ${at}: ${Math.round(d)} USD.`,
    }] : []),
  },
];

/** The free sources this server can call: all of them, less those that need a contact email when none is set. */
export function freeSources({ on = FREE_SOURCES_ON, hasEmail = HAS_EMAIL } = {}) {
  if (!on) return [];
  return FREE_SOURCES.filter((s) => !s.needsEmail || hasEmail);
}

/** A free source as a catalog row: the same shape loadCatalog gives a paid product, at $0. */
export function freeRow(s) {
  return { id: s.id, sellId: s.id, name: s.name, priceUSD: 0, priceFrom: false, free: true, credit: s.credit, topic: s.topic,
    description: s.description, input: s.input, inputOptions: s.inputOptions || [], health: "working", url: `free:${s.id}` };
}

const lastCall = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read at most `max` bytes of a response body; a longer one is refused, never cut into broken JSON. */
async function readCapped(res, max) {
  const reader = res.body?.getReader?.();
  if (!reader) { const t = await res.text(); if (t.length > max) throw new Error(`answer over ${max} bytes`); return t; }
  const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { reader.cancel().catch(() => {}); throw new Error(`answer over ${max} bytes`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * One free call: the source's URL built from the input, a gap since the last call to the same host, the User-Agent,
 * a time and byte cap, then the adapter. The result holds the items (each with code-written `text`) and the request.
 * An answer with no matching records is { items: [] }, never an error.
 */
export async function callFree(id, input = {}, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const s = FREE_SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`${id} is not a free source`);
  const url = s.url(input);
  const wait = (lastCall.get(s.host) || 0) + s.gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(s.host, Date.now());
  const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept: s.format === "xml" ? "application/atom+xml" : "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const at = now().toISOString();
  if (s.emptyStatus && res.status === s.emptyStatus) return { source: s.name, credit: s.credit, request: url, readAt: at, items: [] };
  if (!res.ok) throw new Error(`${s.name}: ${res.status}`);
  const body = await readCapped(res, MAX_BYTES);
  const data = s.format === "xml" ? body : JSON.parse(body);
  const items = s.items(data, input, at).slice(0, 31);
  return { source: s.name, credit: s.credit, request: url, readAt: at, items };
}

/** The result shapes of the free sources, in RESULT_SHAPES form: every item is under `items`. */
export const FREE_SHAPES = {
  "free-openalex-works": { paths: ["items"], fields: { title: "text", year: "number", venue: "text", cited_by: "number", url: "link", text: "body" } },
  "free-crossref-works": { paths: ["items"], fields: { title: "text", type: "text", year: "number", venue: "text", url: "link", text: "body" } },
  "free-arxiv-papers": { paths: ["items"], fields: { title: "text", authors: "text", published: "date", url: "link", summary: "body", text: "body" } },
  "free-sec-edgar-search": { paths: ["items"], fields: { company: "text", form: "text", filed: "date", url: "link", text: "body" } },
  "free-openfda-drug-recalls": { paths: ["items"], fields: { firm: "text", classification: "text", status: "text", reported: "text", reason: "text", product: "text", url: "link", text: "body" } },
  "free-usgs-earthquakes": { paths: ["items"], fields: { magnitude: "number", place: "text", time: "text", url: "link", text: "body" } },
  "free-nasa-power-daily": { paths: ["items"], fields: { date: "date", t2m: "number", rain_mm: "number", url: "link", text: "body" } },
  "free-worldbank-indicator": { paths: ["items"], fields: { country: "text", indicator: "text", year: "text", value: "number", url: "link", text: "body" } },
  "free-gbif-species": { paths: ["items"], fields: { name: "text", rank: "text", kingdom: "text", family: "text", url: "link", text: "body" } },
  "free-wikipedia-search": { paths: ["items"], fields: { title: "text", snippet: "text", url: "link", text: "body" } },
  "free-npm-packages": { paths: ["items"], fields: { name: "text", version: "text", description: "text", weekly_downloads: "number", updated: "date", url: "link", text: "body" } },
  "free-openlibrary-books": { paths: ["items"], fields: { title: "text", authors: "text", first_published: "number", editions: "number", url: "link", text: "body" } },
  "free-coingecko-markets": { paths: ["items"], fields: { name: "text", symbol: "text", price_usd: "number", market_cap_usd: "number", change_24h_pct: "number", updated: "date", url: "link", text: "body" } },
  "free-defillama-tvl": { paths: ["items"], fields: { protocol: "text", tvl_usd: "number", read_at: "date", url: "link", text: "body" } },
};
