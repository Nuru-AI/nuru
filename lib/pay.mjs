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
  const balance = async () =>
    Number(formatUnits(await publicClient.readContract({
      address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    }), 6));
  return { address: account.address, paidFetch, balance };
}

function decode(h) {
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch { return null; }
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
