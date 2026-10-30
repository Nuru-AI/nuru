---
name: sippar-pay
description: How an agent pays Sippar per call. Three ways: an Unlock card (bought by card, or given), a capped budget the person set up, or the agent's own wallet paying x402 on Base with no account at all.
---

# Paying per call

Every product is one price per call, settled on chain. Nothing is charged for a call that
returns nothing: a failed step is refunded or never drawn, and the response says so.

## An Unlock card

A Sippar Unlock card is prepaid value that spends only on Sippar. A person buys one at
`https://sippar.network/unlock` with a debit or credit card through Stripe, or someone gives you
one, and you get a one-time code. In ChatGPT, Claude or any host: sign in, call `redeem_pass` with
the code once, and every later `buy_product` or workflow draws from the card until it is empty.
`my_budget` shows what is left on the card and on the budget. This is the simplest way to put an
agent to work with a cap: the card is the cap, and nothing is charged beyond it.

A judge or a teammate with no wallet needs only a code and the sign-in.

## A budget

A person signs in at `sippar.network/connect/`, sets up a budget from their own wallet with a
per-purchase cap, and the agent spends within it. `my_budget` shows the balance and the cap.
Sippar can pay only its own products from it.

## The agent's own wallet, x402

For an agent that holds a wallet on Base with USDC, no sign-in is needed. `POST` the product's
URL; the `402` answer carries the amount, the asset and the pay-to address; sign an EIP-3009
authorization for exactly that amount and retry with it in the `X-PAYMENT` header; the response
carries the data and, in its body, the transaction hash. `lib/pay.mjs` in this repository is a
complete client in under 100 lines. Record the receipt before you parse the data: a parse error
after a paid call must never lose the receipt.

## What to tell the person

Before a run, state the total you expect from the live prices and get a yes once. Never buy the
same call twice: a workflow run keys every step so a retry is never charged again, and
`read_purchase` returns what was already bought.

## Receipts

Every paid response names the price, the transaction and who was paid. The page in this
repository shows them beside each claim; `my_knowledge` lists what your wallet bought.
