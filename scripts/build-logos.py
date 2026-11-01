#!/usr/bin/env python3
"""Writes public/logos.js: each source's own site icon, from Sippar's logo engine (Nuru-AI/sippar
tools/secondaries-radar/cache-logos.py, fetch_logo: the site's favicon fitted to a 64px transparent square, stored as a
PNG data URI), the same engine the Sippar connector page's menu uses (demos/connector/build-logos.py). The sites are the
ones public/stages.mjs names in its META table, so a source gets a logo only where its site is known, never a guess.
Usage: python3 scripts/build-logos.py --engine ../sippar/tools/secondaries-radar/cache-logos.py
"""
import argparse, importlib.util, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ap = argparse.ArgumentParser()
ap.add_argument("--engine", required=True, help="path to Sippar's tools/secondaries-radar/cache-logos.py")
args = ap.parse_args()
spec = importlib.util.spec_from_file_location("cache_logos", args.engine)
engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
src = open(os.path.join(ROOT, "public", "stages.mjs")).read()
sites = sorted(set(re.findall(r'site: "([a-z0-9.-]+)"', src)))
out, failed = {}, []
for d in sites:
    try:
        out[d] = engine.fetch_logo(engine.FAVICON % d)
    except Exception as e:
        failed.append("%s (%s)" % (d, e))
with open(os.path.join(ROOT, "public", "logos.js"), "w") as f:
    f.write("/* Each source's own site icon, by domain, from Sippar's logo engine; written by scripts/build-logos.py.\n"
            "   64px PNG data URIs. Do not edit by hand. */\n"
            "globalThis.NURU_LOGOS=" + json.dumps(out) + ";\n")
print("wrote", len(out), "logos for", len(sites), "sites;", "failed:", ", ".join(failed) or "none")
