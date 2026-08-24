#!/usr/bin/env python3
"""Derive an episode's duration from its enclosure's own MPEG audio headers.

The last rung of the duration ladder (see db.set_episode_duration): reached only
when the publisher declares no <itunes:duration> anywhere and the item is not an
ended liveItem. Whole feeds are in that state — Homegrown Hits publishes it on
0 of 149 items — and /api/v1/members/hours scores listening by duration, so
without this rung those shows' listeners can never appear on the #40HPW board.

Method: one ranged read of the file's head (64KB), skip the ID3v2 tag(s), find
the first MPEG frame sync, then read the frame count from the Xing/Info or VBRI
tag and compute `frames * samples_per_frame / sample_rate`. The frame count is
what makes it exact and VBR-safe. When neither tag is present (a plain CBR
file), fall back to `(file_size - audio_start) * 8 / bitrate` with the bitrate
READ FROM THE HEADER, never guessed — the two problem feeds measured are
192kbps and 128kbps, so a guessed constant is off by 50%.

MP4-family enclosures (mp4/m4a/aac-in-mp4) are handled too: the top-level box
chain is walked with ranged reads until `moov` turns up (head for faststart
files, tail otherwise) and `mvhd`'s duration/timescale is the answer. Still
deliberately NOT handled, and recorded as an honest miss instead: ogg/opus
(needs the last page's granule), `.m3u8` live playlists, and endless live
streams (icy-* headers, no sync-verified second frame → clean failure). Of the
misses measured 2026-08-24, 179 of 194 were mp3 and 1 was mp4.

Read-only against third parties, bounded to PROBE_MAX_FETCHES ranged reads of
PROBE_BYTES each. The caller owes podroll.py's politeness rule: serial per
host, and record a network failure as "not tried", never as "no duration".
"""

import struct

import requests

PROBE_BYTES = 65536          # one read's window
PROBE_MAX_FETCHES = 3        # ID3 tags with embedded art can exceed one window
PROBE_TIMEOUT = 20
PROBE_UA = {"User-Agent": "OnlyBoosts/1.0 (+https://onlyboosts.social; duration probe)"}

MAX_SANE_SECONDS = 24 * 60 * 60   # anything past a day is a parse gone wrong
MIN_SANE_SECONDS = 30

# kbps by (version_group, layer); index 0 is "free" and 15 is invalid.
_BITRATES = {
    (1, 1): (None, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448),
    (1, 2): (None, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384),
    (1, 3): (None, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
    (2, 1): (None, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256),
    (2, 2): (None, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
    (2, 3): (None, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
}
# Hz by version bits (3=MPEG1, 2=MPEG2, 0=MPEG2.5); index 3 is invalid.
_SAMPLE_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}


def _parse_frame_header(buf, i):
    """A validated MPEG frame header at buf[i], or None.

    Returns dict: frame_len, samples, sample_rate, bitrate_bps, version_bits,
    layer, mono."""
    if i + 4 > len(buf):
        return None
    b0, b1, b2, b3 = buf[i], buf[i + 1], buf[i + 2], buf[i + 3]
    if b0 != 0xFF or (b1 & 0xE0) != 0xE0:
        return None
    version_bits = (b1 >> 3) & 0x3
    if version_bits == 1:                      # reserved
        return None
    layer_bits = (b1 >> 1) & 0x3
    if layer_bits == 0:                        # reserved
        return None
    layer = 4 - layer_bits                     # 1, 2 or 3
    bitrate_idx = (b2 >> 4) & 0xF
    if bitrate_idx in (0, 15):                 # "free" or invalid — no arithmetic possible
        return None
    sr_idx = (b2 >> 2) & 0x3
    if sr_idx == 3:
        return None
    padding = (b2 >> 1) & 0x1
    mono = ((b3 >> 6) & 0x3) == 3
    vgroup = 1 if version_bits == 3 else 2
    bitrate = _BITRATES[(vgroup, layer)][bitrate_idx] * 1000
    sample_rate = _SAMPLE_RATES[version_bits][sr_idx]
    if layer == 1:
        samples = 384
        frame_len = (12 * bitrate // sample_rate + padding) * 4
    else:
        samples = 1152 if (layer == 2 or vgroup == 1) else 576   # MPEG2/2.5 L3 = 576
        frame_len = samples // 8 * bitrate // sample_rate + padding
    if frame_len < 24:
        return None
    return {"frame_len": frame_len, "samples": samples, "sample_rate": sample_rate,
            "bitrate_bps": bitrate, "version_bits": version_bits, "layer": layer,
            "mono": mono}


def _find_first_frame(buf, start):
    """(offset, header) of the first sync-verified frame at/after `start`.

    A lone sync word is not proof — m4a atoms and ID3 junk contain 0xFFEx bytes —
    so the frame is accepted only if the position it predicts for the NEXT frame
    also parses as a compatible header (same version/layer/sample rate). A
    candidate whose successor lies past the buffer is accepted unverified only
    when nothing verifiable was found first."""
    unverified = None
    i = start
    while i < len(buf) - 4:
        h = _parse_frame_header(buf, i)
        if h:
            nxt = i + h["frame_len"]
            if nxt + 4 <= len(buf):
                h2 = _parse_frame_header(buf, nxt)
                if h2 and (h2["version_bits"], h2["layer"], h2["sample_rate"]) == \
                          (h["version_bits"], h["layer"], h["sample_rate"]):
                    return i, h
            elif unverified is None:
                unverified = (i, h)
        i += 1
    return unverified if unverified else (None, None)


def _id3v2_size(buf, pos):
    """Total byte size of an ID3v2 tag starting at pos, or 0 if none."""
    if buf[pos:pos + 3] != b"ID3" or pos + 10 > len(buf):
        return 0
    flags = buf[pos + 5]
    b = buf[pos + 6:pos + 10]
    size = ((b[0] & 0x7F) << 21) | ((b[1] & 0x7F) << 14) | ((b[2] & 0x7F) << 7) | (b[3] & 0x7F)
    return 10 + size + (10 if flags & 0x10 else 0)


class _LiveStream(Exception):
    """The URL is a live stream, not a file — a permanent property, not a fault."""


def _fetch_range(url, start, session=None):
    """(bytes, total_file_size_or_None) for `Range: start..start+PROBE_BYTES-1`.

    Streams and caps the read, because some hosts ignore Range and answer 200
    with the whole file. Returns (None, None) on any network failure — the
    caller must record that as "not tried", not "no duration".

    ⚠️ Raises _LiveStream on an Icecast/Shoutcast answer. Measured 2026-08-24 on
    stream.bowlafterbowl.com: a LIVE STREAM answers 206 with a sentinel total
    (2^30-1) and valid MPEG frames, so without this check the CBR fallback
    computes a confident 18-hour "duration" for an endless stream. The icy-*/
    ice-* headers are what mark a streaming server, whatever the status code."""
    get = (session or requests).get
    try:
        resp = get(url, headers={**PROBE_UA,
                                 "Range": f"bytes={start}-{start + PROBE_BYTES - 1}"},
                   timeout=PROBE_TIMEOUT, stream=True, allow_redirects=True)
        try:
            if any(k.lower().startswith(("icy-", "ice-")) for k in resp.headers):
                raise _LiveStream()
            if resp.status_code == 206:
                total = None
                cr = resp.headers.get("Content-Range", "")
                if "/" in cr and cr.rsplit("/", 1)[1].isdigit():
                    total = int(cr.rsplit("/", 1)[1])
            elif resp.status_code == 200:
                # Host ignored Range. Only the head of the file is any use.
                if start != 0:
                    return None, None
                cl = resp.headers.get("Content-Length", "")
                total = int(cl) if cl.isdigit() else None
            else:
                return None, None
            parts, n = [], 0
            for chunk in resp.iter_content(chunk_size=16384):
                if not chunk:
                    continue
                parts.append(chunk)
                n += len(chunk)
                if n >= PROBE_BYTES:
                    break
            return b"".join(parts)[:PROBE_BYTES], total
        finally:
            resp.close()
    except _LiveStream:
        raise
    except Exception:
        return None, None


def _be32(b, i):
    return struct.unpack(">I", b[i:i + 4])[0]


def _be64(b, i):
    return struct.unpack(">Q", b[i:i + 8])[0]


def _parse_mvhd_in(buf, moov_off, moov_end):
    """Walk moov's children in `buf` for mvhd; seconds or None. mvhd is
    ordinarily moov's first child, so holding only moov's head is enough."""
    p = moov_off + 8
    while p + 8 <= min(len(buf), moov_end):
        size, typ, hdr = _be32(buf, p), buf[p + 4:p + 8], 8
        if size == 1:
            if p + 16 > len(buf):
                return None
            size, hdr = _be64(buf, p + 8), 16
        if typ == b"mvhd" and p + hdr + 24 <= len(buf):
            version = buf[p + hdr]
            if version == 1 and p + hdr + 32 <= len(buf):
                timescale = _be32(buf, p + hdr + 20)
                duration = _be64(buf, p + hdr + 24)
            else:
                timescale = _be32(buf, p + hdr + 12)
                duration = _be32(buf, p + hdr + 16)
            return duration // timescale if timescale else None
        if size < hdr:
            return None
        p += size
    return None


def _probe_mp4_duration(url, buf, total, session):
    """Duration of an ISO-BMFF (mp4/m4a) file, or None.

    Walks the top-level box chain from the head window; a box past the window
    (mdat, almost always) is skipped with a fresh ranged read at its computed
    end, so a tail-moov file costs one extra request. May raise _LiveStream."""
    base, pos, refetches = 0, 0, 0
    for _ in range(16):
        if pos + 16 > base + len(buf):
            if refetches >= PROBE_MAX_FETCHES:
                return None
            nxt, t2 = _fetch_range(url, pos, session)
            if nxt is None or len(nxt) < 16:
                return None
            base, buf, refetches = pos, nxt, refetches + 1
            total = total if total is not None else t2
        i = pos - base
        size, typ, hdr = _be32(buf, i), buf[i + 4:i + 8], 8
        if size == 1:
            size, hdr = _be64(buf, i + 8), 16
        if typ == b"moov":
            end = i + size if size else len(buf)
            return _parse_mvhd_in(buf, i, end)
        if size < hdr:                       # 0 = "to EOF", and it is not moov
            return None
        pos += size
        if total and pos >= total:
            return None
    return None


def probe_enclosure_duration(url, session=None):
    """(seconds, method) on success; (None, reason) otherwise.

    method: 'xing' | 'vbri' | 'cbr' | 'mp4'. reason: 'fetch' (network — retryable,
    do not negative-cache as a property of the file) or 'unparseable'."""
    if not url or not url.lower().startswith(("http://", "https://")):
        return None, "unparseable"
    try:
        buf, total = _fetch_range(url, 0, session)
    except _LiveStream:
        return None, "unparseable"
    if buf is None or len(buf) < 128:
        return None, "fetch"

    if buf[4:8] == b"ftyp":
        try:
            secs = _probe_mp4_duration(url, buf, total, session)
        except _LiveStream:
            return None, "unparseable"
        if secs and MIN_SANE_SECONDS <= secs <= MAX_SANE_SECONDS:
            return int(secs), "mp4"
        return None, "unparseable"

    # Skip ID3v2 tag(s) — they chain, and embedded art can push audio past one
    # window, in which case re-fetch a window at the computed audio offset.
    pos, base = 0, 0
    for _ in range(PROBE_MAX_FETCHES):
        while True:
            sz = _id3v2_size(buf, pos)
            if not sz:
                break
            pos += sz
            if pos >= len(buf) - 10:
                break
        if pos < len(buf) - 10:
            break
        try:
            nxt, tot2 = _fetch_range(url, base + pos, session)
        except _LiveStream:
            return None, "unparseable"
        if nxt is None or len(nxt) < 128:
            return None, "fetch"
        base, pos, buf = base + pos, 0, nxt
        total = total if total is not None else tot2

    off, h = _find_first_frame(buf, pos)
    if h is None:
        return None, "unparseable"
    audio_start = base + off

    # Xing/Info sits after the side info; VBRI at a fixed 32 bytes past the header.
    side = (17 if h["mono"] else 32) if h["version_bits"] == 3 else (9 if h["mono"] else 17)
    frames = None
    tag_at = off + 4 + side
    if buf[tag_at:tag_at + 4] in (b"Xing", b"Info"):
        flags = struct.unpack(">I", buf[tag_at + 4:tag_at + 8])[0]
        if flags & 0x1 and tag_at + 12 <= len(buf):
            frames = struct.unpack(">I", buf[tag_at + 8:tag_at + 12])[0]
            method = "xing"
    if frames is None and buf[off + 4 + 32:off + 4 + 36] == b"VBRI":
        v = off + 4 + 32
        if v + 18 <= len(buf):
            frames = struct.unpack(">I", buf[v + 14:v + 18])[0]
            method = "vbri"

    if frames:
        seconds = frames * h["samples"] // h["sample_rate"]
    elif total and total > audio_start:
        # No VBR tag: assume CBR at the first frame's own bitrate.
        seconds = (total - audio_start) * 8 // h["bitrate_bps"]
        method = "cbr"
    else:
        return None, "unparseable"

    if not (MIN_SANE_SECONDS <= seconds <= MAX_SANE_SECONDS):
        return None, "unparseable"
    return int(seconds), method


if __name__ == "__main__":
    import sys
    for u in sys.argv[1:]:
        print(u, "->", probe_enclosure_duration(u))
