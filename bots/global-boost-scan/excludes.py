#!/usr/bin/env python3
"""Parse `excludes.json` — the list of things OnlyBoosts indexes but must not publish.

The file lives at the REPO ROOT, not next to this module, on purpose: it is the
one operational file a reader who is not running the collector needs to be able
to find, and a takedown request is answered by editing it. See its `_readme`.

Two rules shape everything here:

**Missing is empty, malformed is fatal.** A fresh clone with no `excludes.json`
publishes everything, which is the correct default for a list that is empty
anyway. A file that exists but doesn't parse — an unknown list name, an entry
with no id, an entry with no reason — raises. The failure mode this guards is
the only one that matters: a typo'd key (`"show"` for `"shows"`) silently
excluding nothing, and content that was supposed to be gone staying up because
the pipeline decided the list was empty.

**Reasons are required.** The list is public and its purpose is that anyone can
see what is hidden and why; an entry with no `reason` is the entry that becomes
unexplainable six months later.

Nothing here touches the collector's SQLite index. `db.apply_excludes` projects
this file onto the `excluded_ids` table and the `boosts.excluded` flag, and
every publish path reads those — so an entry removed from the file restores its
content on the next run.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent / "shared") not in sys.path:
    sys.path.insert(0, str(HERE.parent / "shared"))

from nostr_utils import npub_to_hex          # noqa: E402

#: Repo root — bots/global-boost-scan/ → bots/ → the checkout.
DEFAULT_PATH = HERE.parent.parent / "excludes.json"

HEX64 = re.compile(r"^[0-9a-f]{64}$")

#: list name → (accepted id fields, internal kind per field). The kind is what
#: lands in `excluded_ids`; `show` and `show_feed` are two ways of naming the
#: same thing, kept apart because one joins on a guid and the other on a URL.
LISTS = {
    "shows":    {"guid": "show", "feed": "show_feed"},
    "episodes": {"guid": "episode"},
    "boosters": {"npub": "booster", "pubkey": "booster"},
    "boosts":   {"id": "boost"},
}


class ExcludeError(ValueError):
    """The exclusion file is unusable. Never swallowed — see the module docstring."""


class Excludes:
    """The parsed list: `entries` for reporting, `by_kind` for projection."""

    def __init__(self, entries, path):
        self.entries = entries          # [{kind, id, raw, reason, added, source, list}]
        self.path = path

    @property
    def by_kind(self):
        out = {}
        for e in self.entries:
            out.setdefault(e["kind"], set()).add(e["id"])
        return out

    def __len__(self):
        return len(self.entries)

    def summary(self):
        counts = {}
        for e in self.entries:
            counts[e["list"]] = counts.get(e["list"], 0) + 1
        return ", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "empty"


def load(path=None):
    """Parse the exclusion file. Missing file → an empty list; malformed → raise."""
    p = Path(path or DEFAULT_PATH)
    if not p.exists():
        return Excludes([], p)
    try:
        doc = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        raise ExcludeError(f"{p}: not valid JSON — {e}") from e
    if not isinstance(doc, dict):
        raise ExcludeError(f"{p}: top level must be an object of lists")

    entries = []
    for key, value in doc.items():
        # `_readme` / `$comment` and friends are documentation, not data. JSON has
        # no comment syntax, so the file carries its own instructions in a key.
        if key.startswith("_") or key.startswith("$"):
            continue
        if key not in LISTS:
            raise ExcludeError(
                f"{p}: unknown list {key!r} — expected one of {', '.join(LISTS)}. "
                "Nothing was excluded by it; fix the name rather than leaving it.")
        if not isinstance(value, list):
            raise ExcludeError(f"{p}: {key!r} must be a list of entries")
        for i, item in enumerate(value):
            entries.append(_entry(p, key, i, item))

    seen = {}
    for e in entries:
        dup = seen.get((e["kind"], e["id"]))
        if dup is not None:
            raise ExcludeError(f"{p}: {e['list']}[{e['index']}] repeats "
                               f"{e['raw']!r}, already listed at {dup['list']}[{dup['index']}]")
        seen[(e["kind"], e["id"])] = e
    return Excludes(entries, p)


def _entry(p, key, i, item):
    where = f"{p}: {key}[{i}]"
    if not isinstance(item, dict):
        raise ExcludeError(f"{where}: must be an object, e.g. "
                           f'{{"guid": "…", "reason": "…"}}')
    fields = LISTS[key]
    present = [f for f in fields if item.get(f)]
    if not present:
        raise ExcludeError(f"{where}: needs one of {', '.join(fields)}")
    if len(present) > 1:
        raise ExcludeError(f"{where}: give exactly one of {', '.join(present)} "
                           "— two ids in one entry hide two different things")
    field = present[0]
    raw = str(item[field]).strip()
    reason = str(item.get("reason") or "").strip()
    if not reason:
        raise ExcludeError(f"{where}: `reason` is required — the list is public and "
                           "an unexplained entry is the one nobody can review later")
    return {
        "list":   key,
        "index":  i,
        "kind":   fields[field],
        "field":  field,
        "raw":    raw,
        "id":     _normalize(where, fields[field], field, raw),
        "reason": reason,
        "added":  str(item.get("added") or "").strip() or None,
        "source": str(item.get("source") or "").strip() or None,
    }


def _normalize(where, kind, field, raw):
    """The id as the database stores it: hex pubkeys, lowercased event ids.

    Show and episode guids are opaque and pass through verbatim — an item guid is
    routinely a URL, and a podcast:guid is only *usually* a UUID.
    """
    if kind == "booster":
        if field == "npub":
            hexpk = npub_to_hex(raw)
            if not hexpk:
                raise ExcludeError(f"{where}: {raw!r} is not a decodable npub")
            return hexpk
        if not HEX64.match(raw.lower()):
            raise ExcludeError(f"{where}: `pubkey` must be 64 hex characters "
                               "(use `npub` for the bech32 form)")
        return raw.lower()
    if kind == "boost":
        if not HEX64.match(raw.lower()):
            raise ExcludeError(f"{where}: `id` must be a 64-character hex event id")
        return raw.lower()
    return raw
