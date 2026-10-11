#!/usr/bin/env python3
"""Links people posted on r/uwaterloo next to course codes → data/links/seeds/reddit.json.

    python -I tools/links/reddit_links.py uwaterloo_submissions.zst uwaterloo_comments.zst

Same dump as tools/reddit/index_dump.py. Nothing here is fetched: scripts/find-links.mjs (run weekly by
.github/workflows/find-links.yml) checks each link, keeps only pages that name the course, and finds
archived copies of dead ones.

Two kinds of seed:
  link  the URL itself names a course (student.cs.uwaterloo.ca/~cs245/, …/stat330-notes.pdf): a candidate
        for that course.
  hub   the URL names no course but the post does (a notes site's front page, an exam bank): the
        finder opens it and follows its links that name a course.
"""
import json
import os
import re
import sys
from collections import defaultdict
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "reddit"))
import index_dump as d  # noqa: E402

OUT = os.path.join(d.ROOT, "data", "links", "seeds", "reddit.json")

# Never worth following: Reddit itself, images, calendars and schedules (uwloo has those), sign-in walls,
# chat, shopping, ratings, paywalled homework sites, and forms.
SKIP_HOSTS = re.compile(r"""(^|\.)(
    reddit\.com|redd\.it|reddituploads\.com|imgur\.com|gyazo\.com|puu\.sh|prntscr\.com|fbcdn\.net|giphy\.com|tenor\.com|
    uwflow\.com|ucalendar\.uwaterloo\.ca|ugradcalendar\.uwaterloo\.ca|classes\.uwaterloo\.ca|outline\.uwaterloo\.ca|
    adm\.uwaterloo\.ca|quest\.pecs\.uwaterloo\.ca|quest\.uwaterloo\.ca|learn\.uwaterloo\.ca|crowdmark\.com|piazza\.com|
    mobius\.uwaterloo\.ca|wstore\.uwaterloo\.ca|odyssey\.uwaterloo\.ca|waterlooworks\.uwaterloo\.ca|portal\.uwaterloo\.ca|
    discord\.gg|discord\.com|discordapp\.com|facebook\.com|fb\.com|messenger\.com|twitter\.com|x\.com|instagram\.com|
    linkedin\.com|tiktok\.com|snapchat\.com|amazon\.(ca|com)|ebay\.|kijiji\.ca|ratemyprofessors?\.com|birdcourses\.com|
    coursehero\.com|chegg\.com|studocu\.com|quizlet\.com|scribd\.com|slader\.com|bartleby\.com|letmememe\.com|
    forms\.gle|forms\.office\.com|surveymonkey\.com|strawpoll\.|google\.com|goo\.gl|bit\.ly|tinyurl\.com|
    wikipedia\.org|wolframalpha\.com|stackoverflow\.com|stackexchange\.com|ocw\.mit\.edu|khanacademy\.org
)$""", re.X)
SKIP_PATH = re.compile(r"\.(png|jpe?g|gif|webp|svg|mp4|mov|zip)$", re.I)
TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|ref$|s$|feature$)")
MD_LINK = re.compile(r"\[([^\]\n]{1,200})\]\((https?://[^)\s]+)\)")
BARE = re.compile(r"(?<![(\[])https?://[^\s<>\]\"')]+")
URL_CODE = re.compile(r"(?<![a-z])(" + "|".join(sorted((s.lower() for s in d.SUBJECTS), key=len, reverse=True)) + r")([-_]|%20|\+)?(\d{3})([a-z]?)(?![0-9a-z])")


def normalize(url):
    url = url.replace("&amp;", "&").replace("\\_", "_").replace("\\", "").rstrip(".,;:!?*")
    while url.endswith(")") and url.count("(") < url.count(")"):
        url = url[:-1]
    try:
        p = urlsplit(url)
    except ValueError:
        return None
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    host = p.netloc.lower().removeprefix("www.").split(":")[0]
    query = urlencode([(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not TRACKING.match(k)])
    return urlunsplit((p.scheme, p.netloc.lower(), p.path or "/", query, "")), host


def url_codes(url):
    """Course codes a URL names: ~cs245, stat330-notes.pdf, /CS/341/ (a separator only between real codes)."""
    out = []
    low = url.lower()
    for m in URL_CODE.finditer(low):
        subj = m.group(1).upper()
        sep, num, suf = m.group(2), m.group(3), m.group(4)
        if subj in d.CAPS_ONLY and sep:  # "me-100" in a path is more often a word than a course
            continue
        out.append(subj + num + (suf.upper() if suf == "l" else ""))
    return list(dict.fromkeys(out))


def links_in(text):
    """(url, anchor text) pairs in a post or comment."""
    text = text or ""
    seen = set()
    for m in MD_LINK.finditer(text):
        seen.add(m.group(2))
        yield m.group(2), m.group(1)
    for m in BARE.finditer(text):
        if m.group(0) not in seen:
            yield m.group(0), None


def main(subs, comments):
    seeds = defaultdict(lambda: {"codes": set(), "text_codes": set(), "n": 0, "first": None, "last": None, "thread": None, "anchor": None})

    def take(o, text, post, comment):
        if not text:
            return
        t = d.num(o.get("created_utc"))
        tcodes = set(d.codes_in(d.clean(text)))
        for raw, anchor in links_in(text):
            got = normalize(raw)
            if not got:
                continue
            url, host = got
            if SKIP_HOSTS.search(host) or SKIP_PATH.search(urlsplit(url).path):
                continue
            ucodes = set(url_codes(url))
            if anchor:
                ucodes |= set(d.codes_in(anchor)) & tcodes if not ucodes else set()
            if not ucodes and not tcodes:
                continue
            s = seeds[url]
            s["codes"] |= ucodes
            s["text_codes"] |= tcodes
            s["n"] += 1
            if s["first"] is None or t < s["first"]:
                s["first"], s["thread"] = t, {"post": post, **({"comment": comment} if comment else {})}
                s["anchor"] = anchor or s["anchor"]
            s["last"] = max(s["last"] or 0, t)

    n = 0
    for o in d.rows(subs):
        n += 1
        if d.gone(o, "selftext") and d.gone(o, "title"):
            continue
        text = " ".join(x for x in (o.get("title"), o.get("selftext")) if x and x.strip() not in d.GONE)
        if o.get("url") and not o.get("is_self"):
            text += f" {o['url']}"
        take(o, text, o.get("id"), None)
    print(f"  posts: {n:,}", file=sys.stderr)
    n = 0
    for o in d.rows(comments):
        n += 1
        if d.gone(o, "body"):
            continue
        take(o, o.get("body"), (o.get("link_id") or "")[3:], o.get("id"))
        if n % 500_000 == 0:
            print(f"  comments: {n:,}", file=sys.stderr)

    out = []
    for url, s in sorted(seeds.items()):
        kind = "link" if s["codes"] else "hub"
        codes = sorted(s["codes"]) if s["codes"] else sorted(s["text_codes"])
        if kind == "hub" and (len(codes) > 6 or s["n"] < 2 and len(codes) > 3):
            continue  # a link in a long list of courses says nothing about any one of them
        out.append({"url": url, "kind": kind, "codes": codes, "n": s["n"], "first": s["first"], "last": s["last"],
                    "thread": s["thread"], **({"anchor": s["anchor"][:120]} if s["anchor"] else {})})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "r/uwaterloo dump (Watchful1), 2009 to Dec 2024", "seeds": out}, f, ensure_ascii=False, indent=0, separators=(",", ":"))
        f.write("\n")
    links = sum(1 for x in out if x["kind"] == "link")
    print(f"{len(out):,} seeds ({links:,} links naming a course, {len(out) - links:,} hubs) → {os.path.relpath(OUT, d.ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
