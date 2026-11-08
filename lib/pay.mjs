// The agent's wallet: pays x402 requests per call and keeps every receipt.
import { readFileSync } from "fs";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// A seller that never answers must not hold the run (or the page) forever.
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS || 120000);

export function loadWallet() {
  const key = (process.env.AGENT_WALLET_KEY ||
    readFileSync(process.env.AGENT_WALLET_KEY_FILE || "", "utf8")).trim();
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client().register("eip155:8453", new ExactEvmScheme(signer));
  const paidFetch = wrapFetchWithPayment(fetch, client);
  // The same payer over a fetch of the caller's choosing: paidPostAsync passes one that keeps the payment header.
  const wrap = (f) => wrapFetchWithPayment(f, client);
  const balance = async () =>
    Number(formatUnits(await publicClient.readContract({
      address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    }), 6));
  return { address: account.address, paidFetch, wrap, balance };
}

function decode(h) {
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch { return null; }
}

/**
 * What an answer from a sell door says was paid, or null when no money moved. A success carries the payment under
 * `data` ({ data: { paymentTx, amountUSD } }); a paid call the door could not complete carries it at the top
 * ({ success: false, paid: true, paymentReusable, paymentTx }). Both moved USDC out of the wallet, so both go in the
 * ledger (Nuru-AI/sippar#7065: two Tavily calls answered 502 after paying, and the ledger showed $0 of the $0.10 spent).
 * `delivered: false` marks a payment that bought nothing; `reusable` marks one the door kept open for a retry.
 */
export function paymentOf(r) {
  const top = r?.data && typeof r.data === "object" ? r.data : {};
  const d0 = top.data && typeof top.data === "object" ? top.data : {};
  const tx = d0.paymentTx || top.paymentTx || r?.receipt?.transaction || null;
  if (!tx) return null;
  const p = { priceUsd: d0.amountUSD ?? top.amountUSD ?? r.priceUsd ?? 0, tx, payTo: r.payTo };
  if (!r.ok) { p.delivered = false; if (top.paymentReusable === true) p.reusable = true; }
  return p;
}

// POST a JSON body to an x402 endpoint. Returns the body, the price asked and the receipt.
export async function paidPost(wallet, url, body) {
  const probe = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  let priceUsd = null, payTo = null;
  if (probe.status === 402) {
    const req = decode(probe.headers.get("payment-required")) || (await probe.json().catch(() => null));
    const exact = req?.accepts?.find((a) => a.scheme === "exact" && a.network === "eip155:8453");
    if (exact) { priceUsd = Number(exact.amount) / 1e6; payTo = exact.payTo; }
  } else if (probe.ok) {
    return { ok: true, status: probe.status, data: await probe.json(), priceUsd: 0, receipt: null };
  }
  const started = Date.now();
  const res = await wallet.paidFetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const receipt = decode(res.headers.get("payment-response") || res.headers.get("x-payment-response"));
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 2000) }; }
  return { ok: res.ok, status: res.status, data, priceUsd, payTo, receipt, ms: Date.now() - started };
}

/**
 * A SLOW PRODUCT, BOUGHT SO THE ANSWER IS NEVER LOST (Sippar's sell door contract, `collect` on every catalog row and
 * 402). The paid call is sent with `Prefer: respond-async`; the door answers 202 at once with the purchase's settlement
 * key, and the answer is collected at the collect URL by presenting the exact payment header that paid, which is free
 * and never charges again. That header is kept here, from the request the x402 client actually sends (it builds a
 * Request with PAYMENT-SIGNATURE set): without it a timed-out call cannot be collected (2026-10-29, $0.62 lost).
 * Refuses before paying when the price asked is over `maxPriceUsd`. `bodyForPrice(price)`, when given, builds the paid
 * request from the price the door quoted (the planner is told the budget left after its own price).
 */
export async function paidPostAsync(wallet, url, body, { bodyForPrice, maxPriceUsd, maxWaitMs = 300_000, everyMs = 10_000, onWait = () => {}, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const json = { "content-type": "application/json" };
  const probe = await fetchImpl(url, { method: "POST", headers: json, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (probe.status !== 402) {
    const data = await probe.json().catch(() => ({}));
    return { ok: probe.ok, status: probe.status, data, priceUsd: 0, receipt: null, refused: !probe.ok };
  }
  const req = decode(probe.headers.get("payment-required")) || (await probe.json().catch(() => null));
  const exact = req?.accepts?.find((a) => a.scheme === "exact" && a.network === "eip155:8453");
  const priceUsd = exact ? Number(exact.amount) / 1e6 : null;
  if (priceUsd === null) return { ok: false, status: 402, data: { error: "no Base USDC offer in the 402" }, priceUsd: 0, refused: true };
  if (maxPriceUsd !== undefined && priceUsd > maxPriceUsd + 1e-9) return { ok: false, status: 402, data: { error: `asked $${priceUsd}, more than $${maxPriceUsd}` }, priceUsd: 0, refused: true };

  let sig = null, sigName = "PAYMENT-SIGNATURE";
  const keep = async (input, init) => {
    const r = input instanceof Request ? input : new Request(input, init);
    for (const name of ["PAYMENT-SIGNATURE", "X-PAYMENT"]) { const h = r.headers.get(name); if (h) { sig = h; sigName = name; break; } }
    return fetchImpl(r);
  };
  const started = Date.now();
  const paidBody = bodyForPrice ? bodyForPrice(priceUsd) : body;
  const res = await wallet.wrap(keep)(url, { method: "POST", headers: { ...json, Prefer: "respond-async" }, body: JSON.stringify(paidBody), signal: AbortSignal.timeout(60_000) });
  const first = await res.json().catch(() => ({}));
  const paymentTx = first.paymentTx || decode(res.headers.get("payment-response"))?.transaction || null;
  const paid = { priceUsd: first.amountUSD ?? priceUsd, tx: paymentTx, settlementKey: first.settlementKey || null };
  if (res.status !== 202) return { ok: res.ok, status: res.status, data: first, ...paid, ms: Date.now() - started, header: !!sig };
  if (!sig) return { ok: false, status: 202, data: { error: "paid, but the payment header was not kept, so the answer cannot be collected", ...first }, ...paid, ms: Date.now() - started };

  const collectUrl = first.collect?.collectUrl || `${url}/collect`;
  const headerName = sigName;
  let presentedAgain = null;
  while (Date.now() - started < maxWaitMs) {
    await sleep(everyMs);
    onWait({ seconds: Math.round((Date.now() - started) / 1000) });
    const c = await fetchImpl(collectUrl, { method: "POST", headers: { ...json, [headerName]: sig }, body: "{}", signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!c || c.status === 409) continue;
    const data = await c.json().catch(() => ({}));
    /* THE RUN ENDED WITH NOTHING SPENT, AND THE SAME PAYMENT CAN STILL BUY IT (Nuru-AI/sippar#7121). Sippar's collect
       says so with `RUN_ENDED_PAYMENT_UNUSED` and `paymentReusable: true` (#7120): on 2026-11-07 two workflow-planner
       runs found no AntSeed seller, and this loop returned that answer as a failure and the page dropped a plan that
       was still paid for. Present the same header once more, to the URL that was paid (never one read from the
       answer), with the same body. A plain fetch, not the wallet: this can never sign a new payment, and a 402 here is
       returned as it is. Once only, so a seller that is still down ends the run instead of looping on it. */
    if (!presentedAgain && data?.code === "RUN_ENDED_PAYMENT_UNUSED" && data?.paymentReusable === true) {
      presentedAgain = String(data.error || "the first run ended with nothing spent").slice(0, 200);
      const again = await fetchImpl(url, { method: "POST", headers: { ...json, Prefer: "respond-async", [headerName]: sig }, body: JSON.stringify(paidBody), signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (again?.status === 202) continue;
      const d2 = again ? await again.json().catch(() => ({})) : { error: "presenting the same payment again got no answer" };
      return { ok: !!again?.ok, status: again?.status ?? 0, data: d2, ...paid, ms: Date.now() - started, presentedAgain };
    }
    return { ok: c.ok, status: c.status, data, ...paid, ms: Date.now() - started, collected: true, ...(presentedAgain ? { presentedAgain } : {}) };
  }
  return { ok: false, status: 504, data: { error: `still running after ${Math.round(maxWaitMs / 1000)} s; collectable for 15 minutes with the same payment header` }, ...paid, ms: Date.now() - started, ...(presentedAgain ? { presentedAgain } : {}) };
}
