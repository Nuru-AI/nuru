---
name: sippar-workflows
description: Workflows Sippar runs for an agent under one purchase: a plan over the whole shelf for one request (plan_workflow), who buys a product and where they talk (audience_discovery), YouTube trends for a niche (video_trend_finder), competitor discovery (competitor_discovery). Call once, read back with read_purchase, keep polling until finished.
---

# Workflows Sippar runs for you

A workflow tool opens one purchase for a whole multi-step run and Sippar buys every step itself,
each under its own key, so nothing is charged twice and a retry never pays again. You call it
once, then read the run back.

- `plan_workflow` `{ "request": "...", "budgetUSD": N }`: Sippar looks for an agent skill about
  the job, has a strong model write a plan over its own shelf as steps and a closed set of code
  moves (merge, dedupe, filter, rank, top, for_each), checks the plan in code, buys the steps
  within your budget and returns the data. A product id the model wrote one letter off the
  shelf is read as the shelf id and the plan says so ("Sippar's check noted: ..."). The plan is
  written by a model Sippar buys on a peer-to-peer inference network, not by your own model.
- `video_trend_finder` `{ "niche": "...", "audience": "...", "phrasings": [...] }`: two YouTube
  searches, a filter, ranking by views per hour, details on the top five.
- `competitor_discovery`: the nine-step research run, priced per cell at the live rate, from your
  budget or Unlock card.
- `audience_discovery` `{ "category": "...", "buyers": "business" | "consumer", "industry": "...",
  "company": "...", "roles": N, "budgetUSD": N }`: who buys a product, then where they talk. A
  profile of the likely buyers from NVIDIA's Nemotron-Personas-USA (synthetic US adults, CC BY 4.0,
  not real customers; say so in the answer), web searches on the category and on your company if
  you name one, Reddit and X, and for business buyers the US companies hiring the buyers' jobs; for
  consumer buyers, YouTube reviews and the brands advertising to them on Meta. At most $5.

## Reading a run back

`read_purchase` with the purchase id waits a short while on the server and answers with the run
so far. A plan alone takes one to four minutes, and the steps run after it. Keep calling
`read_purchase` every 30 seconds until the answer says the run is finished; a headless agent that
stops after two "still going" answers reports nothing while the run goes on (measured
2026-10-29). Once finished, the answer carries every step, what it bought, the data, the skills
credited and the total spent. `save_reading` keeps your own notes against the run.

## Budget

`budgetUSD` is a hard cap for the whole run, the plan's own price included. Without a covering
Unlock card or budget, `plan_workflow` returns the plan as text and your own model buys the steps with
`buy_product`.
