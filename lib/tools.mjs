// The closed list of sources the planner may choose from. Anything else is refused in code.
import { paidPost } from "./pay.mjs";

const SIPPAR = process.env.SIPPAR_SELL_URL || "https://sippar.network/api/sippar/sell";

async function sippar(wallet, product, body, onPaid) {
  const r = await paidPost(wallet, `${SIPPAR}/${product}`, body);
  const d0 = r.data?.data || {};
  if (d0.paymentTx) onPaid?.({ priceUsd: d0.amountUSD ?? r.priceUsd, tx: d0.paymentTx, payTo: r.payTo });
  if (!r.ok) throw new Error(`${product}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  const d = r.data?.data || {};
  return {
    result: d.result ?? d,
    payment: { priceUsd: d.amountUSD ?? r.priceUsd, tx: d.paymentTx || r.receipt?.transaction || null, payTo: r.payTo },
  };
}

// Each tool returns { documents: [{ title, url, text, publisher, date }], payment }.
export const TOOLS = {
  web_search: {
    describe: "Web search: Tavily's live web search (ranked pages with excerpts and Tavily's own answer), bought per call through Sippar. Input { query }.",
    seller: "Tavily, through Sippar", rail: "x402, USDC on Base",
    async run(w, { query }, onPaid) {
      const { result, payment } = await sippar(w, "web-search", { query }, onPaid);
      const r = result?.response || result;
      const items = r?.results || [];
      return {
        documents: items.slice(0, 6).map((x) => ({ title: x.title, url: x.url, text: x.content || x.raw_content || "", publisher: host(x.url) })),
        payment,
      };
    },
  },
  read_page: {
    describe: "The clean text of one web page by its link, bought per call through Sippar. Input { url }.",
    seller: "Exa, through Sippar", rail: "x402, USDC on Base",
    async run(w, { url }, onPaid) {
      const { result, payment } = await sippar(w, "web-content", { url }, onPaid);
      const c = result?.content || result;
      const x = (c?.results || [])[0] || c || {};
      const text = x.text || x.content || x.raw_content || "";
      return {
        documents: text ? [{ title: x.title || url, url: x.url || url, text: String(text).slice(0, 12000), publisher: host(x.url || url), date: x.publishedDate }] : [],
        payment,
      };
    },
  },
  news: {
    describe: "Google News headlines and snippets for a query, bought per call through Sippar. Input { query }.",
    seller: "Sippar (Google News via OpenWeb Ninja)", rail: "x402, USDC on Base",
    async run(w, { query }, onPaid) {
      const { result, payment } = await sippar(w, "news-search", { query }, onPaid);
      const d = result?.response?.data;
      const items = (Array.isArray(d) ? d : d?.news) || result?.articles || [];
      return {
        documents: items.slice(0, 8).map((a) => ({
          title: a.title, url: a.link || a.url, text: [a.snippet, a.title].filter(Boolean).join(" "),
          publisher: a.source_name || a.source || host(a.link || a.url), date: a.published_datetime_utc || a.date,
        })),
        payment,
      };
    },
  },
  dataconomy_search: {
    describe: "Search Dataconomy, a Berlin tech and data publication: headlines, dates, links, excerpts. Keyword search: use 2 to 4 plain keywords, not a sentence. Bought per call through Sippar; the publisher is paid per read. Input { query }.",
    seller: "Dataconomy, through Sippar", rail: "x402, USDC on Base",
    async run(w, { query }, onPaid) {
      const { result, payment } = await sippar(w, "dataconomy-search", { query }, onPaid);
      return {
        documents: (result.articles || []).map((a) => ({
          title: a.title, url: a.link, text: a.excerpt || "", publisher: "Dataconomy", date: a.publishedAt,
        })),
        payment,
      };
    },
  },
  dataconomy_article: {
    describe: "The full text of one Dataconomy article by its link. Bought per call through Sippar; the publisher is paid per read. Input { url }.",
    seller: "Dataconomy, through Sippar", rail: "x402, USDC on Base",
    async run(w, { url }, onPaid) {
      const { result, payment } = await sippar(w, "dataconomy-article", { url }, onPaid);
      const a = result.article || result;
      return {
        documents: [{ title: a.title || url, url: a.link || url, text: (a.text || a.content || "").slice(0, 12000), publisher: "Dataconomy", date: a.publishedAt }],
        payment,
      };
    },
  },
  papers: {
    describe: "Scholarly papers (OpenAlex, Crossref, arXiv, PubMed metadata) by search words, DOI or PubMed id, bought per call through Sippar. Input { query }.",
    seller: "Sippar (open scholarly metadata)", rail: "x402, USDC on Base",
    async run(w, { query }, onPaid) {
      const { result, payment } = await sippar(w, "paper-search", { query }, onPaid);
      const items = result.papers || result.results || result.records || (Array.isArray(result) ? result : []);
      return {
        documents: items.slice(0, 6).map((p) => ({
          title: p.title, url: p.url || (p.doi ? `https://doi.org/${p.doi}` : ""), text: [p.title, p.abstract, p.venue, p.year].filter(Boolean).join(". "),
          publisher: p.venue || "scholarly record", date: String(p.year || ""),
        })),
        payment,
      };
    },
  },
};

function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }

export function toolMenu() {
  return Object.entries(TOOLS).map(([id, t]) => `- ${id}: ${t.describe}`).join("\n");
}
