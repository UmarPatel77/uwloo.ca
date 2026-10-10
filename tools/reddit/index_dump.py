#!/usr/bin/env python3
"""r/uwaterloo dump -> data/reddit/{SUBJ}.json: every post and comment that mentions a course.

Input: the per-subreddit files from Watchful1's "Subreddit comments/submissions" torrent
(uwaterloo_submissions.zst, uwaterloo_comments.zst; zstandard-compressed JSON lines).

    python -I tools/reddit/index_dump.py path/to/uwaterloo_submissions.zst path/to/uwaterloo_comments.zst

For each mention it keeps the post, the thread starter (the top-level comment the reply hangs
from) and the comment itself, so the site can show the conversation in order:

    post  ->  thread starter  ->  the comment that mentions the course

TEXT controls how much wording is stored (data/reddit is public once pushed):
    --text none     ids, dates, scores and titles only
    --text snippet  plus a short verbatim excerpt of each part (default)
Anything deleted or removed when it was archived is left out entirely, and text is never
reworded. Needs: pip install zstandard
"""
import argparse
import collections
import io
import json
import os
import re
import sys

import zstandard

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

# --------------------------------------------------------------------------
# Course codes
# --------------------------------------------------------------------------

# UW subject codes seen on r/uwaterloo (checked against the dump: real codes are mostly written in
# capitals, English words mostly in lowercase). The site only shows codes that exist in a calendar,
# so an extra code here is harmless; a missing one loses mentions.
SUBJECTS = set("""
ACC ACTSC AE AFM AHS AMATH ANTH APPLS ARBUS ARCH ARCHL ARTS ASL AVIA BASE BE BET BIOL BME BUS CDNST
CHE CHEM CHINA CI CIVE CLAS CMW CO COGSCI COMMST CROAT CS DAC DUTCH EARTH EASIA ECE ECON EMLS ENBUS
ENGL ENVE ENVS ERS FINE FR GBDA GENE GEOE GEOG GER GERON GRK GSJ HEALTH HIST HLTH HRM HRTS HUMSC INDEV
INTEG INTST ITAL ITALST JAPAN JS KIN KOREA LAT LS MATBUS MATH ME MEDVL MNS MSCI MSE MTE MTHEL MUSIC NE
OPTOM PACS PD PHARM PHIL PHYS PLAN PMATH PORT PSCI PSYCH QIC REC RS RUSS SCBUS SCI SDS SE SFM SI SMF SOC
SOCWK SPAN SPCOM STAT STV SUSM SYDE THPERF UKRAN UNIV VCULT WKRPT WS
""".split())

# Informal spellings -> code
INFORMAL = {"STATS": "STAT", "ACTSCI": "ACTSC", "PSYC": "PSYCH", "BIO": "BIOL", "HEALTH": "HLTH", "AM": "AMATH",
            "CNO": "CO", "C&O": "CO", "E&CE": "ECE"}

# Lowercase is accepted ("cs135", "math 135") except for codes that are also common words or
# slang ("me 100", "fine 100", "so 2"): those count only in capitals.
CAPS_ONLY = {"AE", "AM", "ARTS", "BE", "BET", "BIO", "BU", "BUS", "CHINA", "CI", "CO", "DAC", "EARTH", "FINE",
             "FR", "GENE", "HEALTH", "JAPAN", "JS", "KIN", "KOREA", "LAT", "LS", "ME", "MUSIC", "NE", "PD",
             "PLAN", "PORT", "REC", "RS", "SE", "SI", "SOC", "SPAN", "UNIV", "WS"}

NUM = r"\d{3}[A-Za-z]?"
CODE_RE = re.compile(r"(?<![A-Za-z0-9&])(C&O|E&CE|[A-Za-z]{2,6})[ \-]?(" + NUM + r")(?![0-9A-Za-z%$])"
                     r"((?:\s*(?:/|,|&|\band\b|\bor\b)\s*" + NUM + r"(?![0-9A-Za-z%$]))*)")
MORE_RE = re.compile(r"(\d{3}[A-Za-z]?)")


def codes_in(text):
    """{code: first character offset} for every course mentioned in `text`."""
    out = {}
    for m in CODE_RE.finditer(text or ""):
        raw = m.group(1)
        subj = INFORMAL.get(raw.upper(), raw.upper())
        if subj not in SUBJECTS:
            continue
        if not raw.isupper() and (subj in CAPS_ONLY or raw.upper() in CAPS_ONLY):
            continue
        nums = [m.group(2)] + MORE_RE.findall(m.group(3) or "")
        for n in nums:
            suf = n[3:]
            code = subj + n[:3] + (suf if suf.isupper() or suf == "l" else "")  # CS136L, cs136l; not "135s"
            out.setdefault(code.upper(), m.start())
    return out


# --------------------------------------------------------------------------
# Text
# --------------------------------------------------------------------------

GONE = {"[deleted]", "[removed]", "[ Removed by Reddit ]", "[removed by reddit]"}


def gone(o, field):
    meta = o.get("_meta") or {}
    return (o.get(field) or "").strip() in GONE or meta.get("was_deleted_later") or o.get("removed_by_category")


def clean(s):
    s = re.sub(r"\[([^\]]+)\]\((?:https?://|/)[^)]*\)", r"\1", s or "")   # [text](url) -> text
    s = re.sub(r"(?m)^\s*(?:&gt;|>).*$", "", s)                            # quoted replies
    s = re.sub(r"[*_~`#^]+", "", s).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\s+", " ", s).strip()


def excerpt(text, code=None, limit=280):
    """A verbatim window of `text`: whole sentences around the first mention of `code`, else the start."""
    t = clean(text)
    if not t or len(t) <= limit:
        return t
    pos = codes_in(t).get(code) if code else None
    if pos is None:
        cut = t[:limit]
        end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
        return (cut[:end + 1] if end > limit * 0.5 else cut.rsplit(" ", 1)[0]) + " …"
    start = max(0, pos - limit // 3)
    s = max(t.rfind(". ", 0, pos), t.rfind("? ", 0, pos), t.rfind("! ", 0, pos))
    if s >= start - 80:
        start = s + 2 if s > 0 else 0
    elif start > 0:
        start = t.find(" ", start) + 1
    end = min(len(t), start + limit)
    e = max(t.rfind(". ", start, end), t.rfind("? ", start, end), t.rfind("! ", start, end))
    if e > pos:
        end = e + 1
    elif end < len(t):
        end = t.rfind(" ", start, end)
    out = t[start:end].strip()
    return ("… " if start > 0 else "") + out + (" …" if end < len(t) else "")


# --------------------------------------------------------------------------


def rows(path):
    with open(path, "rb") as f:
        reader = zstandard.ZstdDecompressor(max_window_size=2 ** 31).stream_reader(f)
        for line in io.TextIOWrapper(reader, encoding="utf-8", errors="replace"):
            try:
                yield json.loads(line)
            except ValueError:
                continue


def base36(n):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out or "0"


def parent_of(o):
    """'t1_abc' / 't3_xyz'. A few 2023 rows store the parent as a decimal number instead."""
    p = o.get("parent_id")
    if isinstance(p, int):
        b = base36(p)
        return ("t3_" if b == (o.get("link_id") or "")[3:] else "t1_") + b
    return p or ""


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("submissions")
    ap.add_argument("comments")
    ap.add_argument("--text", choices=["none", "snippet"], default="snippet")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "reddit"))
    args = ap.parse_args()
    keep_text = args.text == "snippet"

    # 1. Posts: everything needed to show a post as context, plus the posts that mention courses.
    posts, mentions = {}, collections.defaultdict(list)
    for o in rows(args.submissions):
        pid = o.get("id")
        if not pid:
            continue
        title = clean(o.get("title"))
        body_gone = gone(o, "selftext")
        posts[pid] = dict(t=num(o.get("created_utc")), title=title, score=num(o.get("score")),
                          n=num(o.get("num_comments")),
                          author=None if (o.get("author") in (None, "[deleted]")) else o.get("author"),
                          body=None if body_gone else (o.get("selftext") or ""))
        found = codes_in(title)
        for code, at in codes_in(o.get("selftext") if not body_gone else "").items():
            found.setdefault(code, None)
        for code in found:
            mentions[code].append(("p", pid, None))
    print("posts: %d, mentioning a course: %d" % (len(posts), sum(len(v) for v in mentions.values())), file=sys.stderr)

    # 2. Comments: parents for every comment (to find each reply's thread starter), and the matches.
    parent, hits = {}, []
    for o in rows(args.comments):
        cid = o.get("id")
        if not cid:
            continue
        parent[cid] = parent_of(o)
        if gone(o, "body"):
            continue
        found = codes_in(o.get("body"))
        if found:
            hits.append((cid, (o.get("link_id") or "")[3:], found))
    print("comments: %d, mentioning a course: %d" % (len(parent), len(hits)), file=sys.stderr)

    def starter(cid):
        """Top-level comment above `cid` (None if `cid` is itself top-level or the chain is broken)."""
        seen, cur = 0, cid
        while seen < 200:
            p = parent.get(cur, "")
            if p.startswith("t3_"):
                return cur if cur != cid else None
            if not p.startswith("t1_"):
                return None
            cur, seen = p[3:], seen + 1
        return None

    need, starter_of = {}, {}
    for cid, pid, found in hits:
        top = starter(cid)
        if top:
            need[top] = None
            starter_of[cid] = top
        need[cid] = found
        for code, at in found.items():
            mentions[code].append(("c", pid, cid))
    # 3. Text for the matches and their thread starters.
    info = {}
    for o in rows(args.comments):
        cid = o.get("id")
        if cid in need:
            info[cid] = dict(t=num(o.get("created_utc")), score=num(o.get("score")),
                             author=None if o.get("author") in (None, "[deleted]") else o.get("author"),
                             body=None if gone(o, "body") else o.get("body"))
    del parent

    # 4. Write one file per subject: {code: [entries newest first]}
    by_subject = collections.defaultdict(dict)
    for code, items in mentions.items():
        subj = re.match(r"[A-Z]+", code).group(0)
        out, seen = [], set()
        for kind, pid, cid in items:
            key = (pid, cid)
            if key in seen or pid not in posts:
                continue
            seen.add(key)
            p = posts[pid]
            e = dict(post=pid, t=p["t"], title=p["title"], score=p["score"], n=p["n"])
            if kind == "p":
                e["in"] = "post"
                if keep_text and p["body"]:
                    e["post_text"] = excerpt(p["body"], code)
                    e["post_author"] = p["author"]
            else:
                c = info.get(cid)
                if not c or c["body"] is None:
                    continue
                e.update(comment=cid, t=c["t"], c_score=c["score"], **{"in": "comment"})
                if keep_text:
                    e["text"] = excerpt(c["body"], code)
                    e["author"] = c["author"]
                    if p["body"]:
                        e["post_text"] = excerpt(p["body"], limit=200)
                    top = starter_of.get(cid)
                    if top and top in info:
                        t = info[top]
                        e["starter"] = top
                        e["starter_text"] = excerpt(t["body"], limit=200) if t["body"] is not None else "[deleted]"
                        e["starter_author"] = t["author"]
            out.append(e)
        out.sort(key=lambda e: -e["t"])
        if out:
            by_subject[subj][code] = out
    os.makedirs(args.out, exist_ok=True)
    total = 0
    for subj, codes in sorted(by_subject.items()):
        with open(os.path.join(args.out, "%s.json" % subj), "w", encoding="utf-8") as f:
            json.dump(codes, f, ensure_ascii=False, separators=(",", ":"))
        total += sum(len(v) for v in codes.values())
    newest = max(p["t"] for p in posts.values())
    with open(os.path.join(args.out, "_meta.json"), "w") as f:
        json.dump(dict(source="Arctic Shift / Watchful1 per-subreddit dump", through=newest, text=args.text,
                       courses=sum(len(c) for c in by_subject.values()), mentions=total), f)
    print("wrote %d subjects, %d courses, %d mentions -> %s" % (len(by_subject), sum(len(c) for c in by_subject.values()),
                                                               total, os.path.relpath(args.out, ROOT)), file=sys.stderr)


if __name__ == "__main__":
    main()
