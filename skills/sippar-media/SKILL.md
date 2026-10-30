---
name: sippar-media
description: Buy one image or one video clip per call through Sippar, from open-weight and other models served on a peer-to-peer inference network, and get the file back; compare several image models on one prompt.
---

# Images and video

Images and clips are products like any other on the shelf: one call, one file back, the model
and the seller named on the response. Sippar buys them for you on a peer-to-peer inference
network and returns the file as the seller sent it.

- `image-generation`: one image from a description, from an open-weight model. Per-model
  products are listed as `image-<model>`; `list_products` shows which, with the live price.
  Options such as size, output format and aspect ratio reach the model where it takes them.
- `video-<model>`: one short clip from a description, or from a start frame (and an end frame
  where the model takes one). A clip is a job: `buy_product` returns at once with a purchase id,
  and `read_purchase` waits on it and returns the MP4 when it is ready. You are charged only when
  a finished clip is delivered.
- `compare_images`: one prompt to two to four image models side by side, signed in, from your
  budget or Unlock card.

Input for all of them: `{ "query": "<the description>" }` plus the options the product lists
(`model`, `size`, `output_format`, `aspect_ratio`, `duration` where the product takes them; the
shelf entry names each). The field is `query`, not `prompt`: a `prompt` key is refused free,
before anything is bought. Keep a description under 2,500 characters. The response names the model and the seller; keep that line with the
file when you show it.

A model that reads images, such as Nemotron 3.5 Super VL on Nebius Token Factory, can check a
delivered picture or clip against the brief before you use it.
