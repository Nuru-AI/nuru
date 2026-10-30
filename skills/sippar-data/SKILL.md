---
name: sippar-data
description: Buy data per call through Sippar and read it back: web search, page text, news, Reddit, X, LinkedIn, YouTube, papers, a publisher's articles, company and funding data, chain state, what AI models say. Keywords in, the provider's data out, source named.
---

# Buying data per call

`list_products` shows the shelf with each product's description, example input and live price;
`browse_products` shows it as a menu in hosts that draw Sippar's card. Pick a product, call
`buy_product` with `{ "productId": "<id>", "input": { ... } }`, and read the result; in a host
without a card, or over plain HTTP, the data is in the response.

## Families this agent uses

- **Web search**: Tavily's live search (`web-search`), and an answer with its citations
  (`grounded-search`). Tavily's keyless pay-per-search is the design target; during the build
  those calls settled through a reseller of Tavily search, and each response names the path that
  served it. Input `{ "query": "..." }`.
- **Page text**: the clean text of one URL. Input `{ "url": "..." }`.
- **News**: the past week's articles for a search, or the day's top stories; headline, publisher,
  date, link, snippet; no article text. Keywords, not sentences.
- **Social**: public Reddit posts, X posts (X's search operators work), LinkedIn posts (author,
  date, link, counts, never the post text), Facebook and Instagram ads, YouTube videos.
- **Papers**: scholarly records from OpenAlex, Crossref, arXiv and PubMed by search words, DOI
  or PubMed id.
- **A publisher's articles**: Dataconomy, a Berlin tech and data publication: search by two to
  four keywords, then the full text of one article by its link. The publisher is paid per read,
  on chain.
- **Companies and money**: company profiles, funding events, SEC filings, GitHub repositories.
- **Chains**: live state of EVM chains and ranked token contracts, from QuickNode and Nansen.

## Publishers are paid

A share of each `web-search` and `grounded-search` goes to the publishers whose pages appear in its
results, in USDC on Base, when Sippar is paid. Any publisher can be paid this way, into a wallet
created for the publisher's email that only they can open, before they have signed up with anyone.
The first payment reached Dataconomy on 30 October 2026.

## What AI models say

- `ai-visibility`: several AI models are asked the same buyer-style questions about a brand; each
  raw answer comes back labelled with its model and seller, with a count of mentions.
- `second-opinion`: several AI models answer one question, each labelled.
- `council`: AI models answer, then review each other's answers.

## Reading the result

Every response is the provider's data as returned, with a source line. A keyword search that
returns nothing was asked a sentence; shorten it. Numbers you report come from the data, not
from your own arithmetic over it, unless you show the arithmetic.

## In this repository

`lib/agent.mjs` has Nemotron 3 Ultra plan over the live catalog (`lib/catalog.mjs`), buys the
steps, keeps only quotes that appear word for word in what was bought, and writes from those.
`lib/tools.mjs` is the fallback: a closed list of five of these sources, used when the catalog
cannot be read or a plan fails the code check twice.
