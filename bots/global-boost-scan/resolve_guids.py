#!/usr/bin/env python3
"""Phantom-guid resolver for OnlyBoosts.

Some clients put a value that is NOT a podcast:guid into the NIP-73 `podcast:guid`
i-tag — a Podcast Index feed id, an item guid, or a freeform episode slug — which
fragments one real show into many phantom rows. This pass looks at each as-signed
guid that carries no alias yet, decides whether it's a phantom, and if so records
a guid_aliases row mapping it to the real podcast guid. It then materializes those
aliases onto boosts.canonical_guid (db.apply_aliases).

Resolution strategies, cheapest first:
  • suffix-strip   `<uuid>-<n>`  → the base UUID (an episode number glued on).
  • feedurl-local  numeric feed id whose tag URL matches a show we already know.
  • pi-byfeedid    numeric feed id → Podcast Index /podcasts/byfeedid → podcastGuid.
  • pi-byfeedurl   a bare feed URL, or a numeric id with an unknown URL → byfeedurl.
  • curated        freeform slugs, from data/guid_aliases.json (hand-maintained;
                   these have no reliable anchor in the event, so a human decides).

Read-only against Podcast Index; writes only the local index. Never signs/pays.
The as-signed podcast_guid on each boost is left untouched — only canonical_guid
is derived — so the stored row stays faithful to the signed event.
"""

import json
import re
from pathlib import Path

import db
import enrich

HERE = Path(__file__).resolve().parent
CURATED_PATH = HERE / "data" / "guid_aliases.json"

_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_UUID_SUFFIX = re.compile(
    r"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-.+$")
_NUMERIC = re.compile(r"^\d{4,9}$")


def is_uuid(v):
    return bool(v and _UUID.match(v))


def load_curated():
    """Curated freeform map: {"exact": {raw: canonical}, "prefix": [{prefix, canonical}]}.
    Absent/broken file → empty map (curation is optional)."""
    if not CURATED_PATH.exists():
        return {"exact": {}, "prefix": []}
    try:
        c = json.loads(CURATED_PATH.read_text())
        c.setdefault("exact", {})
        c.setdefault("prefix", [])
        return c
    except Exception as e:
        print(f"  [warn] could not read {CURATED_PATH.name}: {e}")
        return {"exact": {}, "prefix": []}


def _curated_lookup(raw_guid, curated):
    hit = curated["exact"].get(raw_guid)
    if hit:
        return hit
    for rule in curated["prefix"]:
        pfx, canon = rule.get("prefix"), rule.get("canonical")
        if pfx and canon and raw_guid.startswith(pfx):
            return canon
    return None


def derive(conn, raw_guid, key, secret, curated):
    """Decide the real podcast guid for one as-signed value.

    Returns (canonical_guid, method, show_dict_or_None) or None if it's already a
    clean guid or can't be resolved. `show_dict` (when a PI lookup produced it) is
    an enrich.resolve_show-shaped dict the caller can cache, sparing a later call.
    """
    if is_uuid(raw_guid):
        return None                                   # already a real guid

    # `<uuid>-<n>`: an episode number appended to the show guid.
    m = _UUID_SUFFIX.match(raw_guid)
    if m and is_uuid(m.group(1)):
        return (m.group(1), "suffix-strip", None)

    # Numeric: a Podcast Index feed id.
    if _NUMERIC.match(raw_guid):
        url = db.sample_tag_url(conn, raw_guid)
        local = db.feed_url_to_guid(conn, url)
        if is_uuid(local):
            return (local, "feedurl-local", None)
        if key and secret:
            show = enrich.resolve_feed_by_id(raw_guid, key, secret)
            if show and is_uuid(show["podcast_guid"]):
                return (show["podcast_guid"], "pi-byfeedid", show)
            if url:
                show = enrich.resolve_feed_by_url(url, key, secret)
                if show and is_uuid(show["podcast_guid"]):
                    return (show["podcast_guid"], "pi-byfeedurl", show)
        return None

    # A bare feed URL landed in the guid field.
    if raw_guid.startswith("http") and key and secret:
        show = enrich.resolve_feed_by_url(raw_guid, key, secret)
        if show and is_uuid(show["podcast_guid"]):
            return (show["podcast_guid"], "pi-byfeedurl", show)
        return None

    # Freeform slug: no anchor in the event — trust the curated map only.
    canon = _curated_lookup(raw_guid, curated)
    if is_uuid(canon) and canon != raw_guid:
        return (canon, "curated", None)
    return None


def resolve_all(conn, key, secret, log=print):
    """Resolve every un-aliased phantom guid, then materialize aliases onto boosts.
    Returns (new_aliases, rekeyed_boosts)."""
    curated = load_curated()
    raw_guids = db.raw_guids_needing_alias(conn)
    log(f"Resolving {len(raw_guids)} un-aliased guid(s)...")
    by_method = {}
    new = 0
    for rg in raw_guids:
        out = derive(conn, rg, key, secret, curated)
        if not out:
            continue
        canonical, method, show = out
        if canonical == rg:
            continue
        db.upsert_alias(conn, rg, canonical, method)
        if show and is_uuid(show["podcast_guid"]):
            db.upsert_show(conn, show)                 # cache the show we just learned
        by_method[method] = by_method.get(method, 0) + 1
        new += 1
    rekeyed = db.apply_aliases(conn)
    if by_method:
        log("  aliases by method: " + ", ".join(f"{m}={n}" for m, n in sorted(by_method.items())))
    log(f"Resolve done: {new} new alias(es), {rekeyed} boost row(s) re-keyed.")
    return new, rekeyed
