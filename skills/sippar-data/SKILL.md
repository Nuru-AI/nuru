---
name: sippar-data
description: Buy data per call through Sippar and read it back: web search, page text, news, Reddit, X, LinkedIn, YouTube, papers, a publisher's articles, company and funding data, chain state. Keywords in, the provider's data out, source named.
---

# Buying data per call

`list_products` shows the shelf with each product's description, example input and live price;
`browse_products` shows it as a menu in hosts that draw Sippar's card. Pick a product, call
`buy_product` with `{ "productId": "<id>", "input": { ... } }`, and read the result; in a host
without a card, or over plain HTTP, the data is in the response.

## Families this agent uses

- **Web search**: Tavily's live search, unchanged, with Tavily's own answer. Sippar pays Tavily
  through Tavily's own pay-per-call door, and through a reseller of Tavily search when that door
  does not settle; the source line says which. Input `{ "query": "..." }`.
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

## Reading the result

Every response is the provider's data as returned, with a source line. A keyword search that
returns nothing was asked a sentence; shorten it. Numbers you report come from the data, not
from your own arithmetic over it, unless you show the arithmetic.

## In this repository

`lib/tools.mjs` is a closed list of five of these products with their input shape and how each
result is turned into documents; `lib/agent.mjs` plans over that list with Nemotron 3 Ultra,
buys, keeps only quotes that appear word for word in what was bought, and writes from those.
