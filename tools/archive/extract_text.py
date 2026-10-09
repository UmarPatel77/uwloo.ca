#!/usr/bin/env python3
"""Course-description text for a scanned calendar -> data/archive-text/{YYyy}.json.

uwloo.ca turns this into real pages (uwloo.ca/8283/math, with #MATH135 anchors) so nobody has
to download the PDF. The PDFs' own text layer is 1990s OCR and too garbled to show, so the
course section is re-OCR'd with Tesseract at 300 dpi, which reads these scans almost perfectly.

Uses index_pdf.py for everything it already knows: each year's era and course-section pages
(YEARS), subject names, OCR-tolerant course-header detection, and the subject start pages in
data/archive/{YYyy}.json (run index_pdf.py first).

    python tools/archive/extract_text.py path/to/1994-95.pdf            # writes data/archive-text/9495.json
    python tools/archive/extract_text.py path/to/1994-95.pdf --workers 4

Needs poppler (pdftoppm) and Tesseract 5. OCR is cached in .cache/ocr/{YYyy}/, so a rerun only
re-splits. About 3.5 s per page per worker.
"""
import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import index_pdf as ip  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

# --------------------------------------------------------------------------
# OCR
# --------------------------------------------------------------------------


def ocr_page(pdf, page, cache, need_tsv=False):
    """Page text; Tesseract also writes word boxes (.tsv), which the side-by-side years need."""
    out = os.path.join(cache, "p%04d" % page)
    if not all(os.path.exists(out + ext) and os.path.getsize(out + ext) > 0
               for ext in (".txt", ".tsv") if ext == ".txt" or need_tsv):
        subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", "-f", str(page), "-l", str(page),
                        "-singlefile", pdf, out], check=True)
        env = dict(os.environ, OMP_THREAD_LIMIT="1")  # threads only add overhead per page
        subprocess.run(["tesseract", out + ".png", out, "--psm", "3", "txt", "tsv"], check=True, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(out + ".png")
    with open(out + ".txt", encoding="utf-8") as f:
        return f.read()


def ocr_section(pdf, lo, hi, cache, workers, need_tsv=False):
    os.makedirs(cache, exist_ok=True)
    pages = {}
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        jobs = {pool.submit(ocr_page, pdf, p, cache, need_tsv): p for p in range(lo, hi + 1)}
        for n, job in enumerate(concurrent.futures.as_completed(jobs), 1):
            pages[jobs[job]] = job.result()
            if n % 25 == 0 or n == len(jobs):
                print("  OCR %d/%d" % (n, len(jobs)), file=sys.stderr)
    return pages


# 1969-75 print each course title in a narrow left column with its description beside it.
# Tesseract reads the title column and the description column as separate blocks, so these
# years are rebuilt from word positions (see side_by_side_lines).
SIDE_BY_SIDE = {"6970", "7071", "7172", "7273", "7374", "7475"}

# --------------------------------------------------------------------------
# Lines
# --------------------------------------------------------------------------

# Running heads and folios: "Course Descriptions", "16:34", "COURSE DESCRIPTION", "-- 112 --".
RUNNING = re.compile(r"(?i)^\s*(course\s+desc\w*|curricula\s+and\s+courses\s+of\s+study|courses\s+of\s+instruction"
                     r"|undergraduate\s+calendar|[-—\s]*\d{1,3}\s*[:;.]?\s*\d{0,3}[-—\s]*|[ivxl]{1,5})\s*$")


# St. Jerome's College suffix J read as "]" or "3": "210] Intermediate Italian", "2303* God and Philosophy"
J_FIX = re.compile(r"^(\s*\d{3})(?:[\]}]|3(?=\*|\s+[A-Z][a-z]))")

# a course number, optionally with a range or section letters: "471*-473", "498(a-b)*", "120R*/121R*"
NUM_RANGE = r"(?:\s?[-\u2013/]\s?\d{3}[A-Za-z]{0,2}\*?|\s?\([a-z]\s?-\s?[a-z]\)\*?)?"
SBS_HEADER = re.compile(r"^\s*(?:[A-Z][A-Za-z&]{0,5}\s?)?(?:\d|[lI](?=\d))[\dOoIl]{2}[A-Za-z]{0,2}\s*[*\u2019'\u201d\".]?"
                        + NUM_RANGE + r"\s+[A-Z(]")
# a bare course number in the title column (1969-75 graduate seminars: "454*" beside "Senior seminar...")
SBS_BARE = re.compile(r"^\s*\d{3}[A-Za-z]{0,2}\s*[*\u2019'\u201d\".]?" + NUM_RANGE + r"\s*$")

# "471*-473 Problems", "498(a-b)* Directed Reading": a range of numbers under one description
RANGE_HEAD = re.compile(r"^\s*(\d{3}[A-Z]?)\*?\s?(?:[-\u2013]\s?(\d{3}[A-Z]?)\*?|\(([a-z])\s?-\s?([a-z])\)\*?)\s+(?=[A-Z(])")


def side_by_side_lines(tsv_path):
    """Text of a 1969-75 page rebuilt from Tesseract's word boxes: each course's title lines (left
    column), a blank line, then the description printed beside them (right column). None when the
    page has no such columns; the plain text is used then."""
    rows = {}
    with open(tsv_path, encoding="utf-8") as f:
        next(f, None)
        for ln in f:
            c = ln.rstrip("\n").split("\t")
            if len(c) == 12 and c[0] == "5" and c[11].strip():
                rows.setdefault((c[2], c[3], c[4]), []).append(
                    (int(c[6]), int(c[7]), int(c[6]) + int(c[8]), int(c[7]) + int(c[9]), c[11]))
    if not rows:
        return None
    # fragments: a line split wherever the gap between words is wider than a column gutter
    frags = []
    for words in rows.values():
        words.sort()
        h = sorted(w[3] - w[1] for w in words)[len(words) // 2]
        cur = [words[0]]
        for w in words[1:]:
            if w[0] - cur[-1][2] > max(28, 1.1 * h):
                frags.append(cur)
                cur = [w]
            else:
                cur.append(w)
        frags.append(cur)
    mk = lambda fr: dict(l=min(w[0] for w in fr), t=min(w[1] for w in fr), r=max(w[2] for w in fr),
                         b=max(w[3] for w in fr), text=J_FIX.sub(r"\1J", " ".join(w[4] for w in fr)), words=fr)
    frags = [mk(fr) for fr in frags]
    width = max(f["r"] for f in frags)
    # the description column's left edge: the most common fragment start right of the titles
    starts = {}
    for f in frags:
        if 0.12 * width < f["l"] < 0.6 * width:
            starts[f["l"] // 12] = starts.get(f["l"] // 12, 0) + 1
    heads = [f for f in frags if SBS_HEADER.match(f["text"]) and f["r"] < 0.6 * width]
    if not starts or not heads:
        return None
    col = max(starts, key=lambda k: starts[k] + starts.get(k - 1, 0) + starts.get(k + 1, 0))
    if starts[col] + starts.get(col - 1, 0) + starts.get(col + 1, 0) < 4:
        return None
    edge = min(f["l"] for f in frags if abs(f["l"] // 12 - col) <= 1) - 6
    # a narrow gutter (1969-70) lets a title and its description read as one line: split it
    # at the description column when a word starts there
    split = []
    for f in frags:
        ws = f["words"]
        ok = [i for i in range(1, len(ws)) if ws[i][0] >= edge - 16 and
              (ws[i - 1][2] <= edge - 4 or ws[i][0] - ws[i - 1][2] >= (12 if ws[i][0] >= edge - 4 else 18))]
        # preference: the previous word ends clearly in the title column; else the first word that
        # starts in the description column; else a wide gap near the edge
        crossing = [i for i in ok if ws[i - 1][2] <= edge - 4]
        inside = [i for i in ok if ws[i][0] >= edge - 4]
        k = (crossing or inside or ok or [None])[0]
        if f["l"] < edge - 40 and k is not None and (re.match(r"\s*\d{3}", f["text"]) or k <= 5):
            a, b = mk(ws[:k]), mk(ws[k:])
            a["side"], b["side"] = "left", "right"
            split += [a, b]
        else:
            split.append(f)
    frags = split
    left = [f for f in frags if f.get("side") == "left" or (not f.get("side") and f["r"] <= edge + 4)]
    right = [f for f in frags if f.get("side") == "right" or (not f.get("side") and f["l"] >= edge)]
    full = [f for f in frags if not f.get("side") and f["l"] < edge and f["r"] > edge + 4]
    if not any(SBS_HEADER.match(f["text"]) for f in left):
        return None
    for f in left:  # a bare header gets a marker the splitter recognises
        if SBS_BARE.match(f["text"]):
            f["text"], f["bare"] = f["text"].strip() + " \u00a7", True
    # segment boundaries: each course header in the title column, and each full-width line
    line_h = sorted(f["b"] - f["t"] for f in frags)[len(frags) // 2]
    is_head = lambda f: SBS_HEADER.match(f["text"]) or f.get("bare")
    cuts = sorted([(f["t"] - line_h // 2, "head", f) for f in left if is_head(f)] +
                  [(f["t"] - line_h // 4, "full", f) for f in full], key=lambda c: c[0])
    bounds = [-10 ** 6] + [c[0] for c in cuts] + [10 ** 6]
    out = []

    def emit(fs):
        prev = None
        for f in sorted(fs, key=lambda f: f["t"]):
            if prev is not None and f["t"] - prev["b"] > 1.2 * line_h:
                out.append("")
            out.append(f["text"])
            prev = f

    for i in range(len(bounds) - 1):
        lo_y, hi_y = bounds[i], bounds[i + 1]
        if i and cuts[i - 1][1] == "full":
            out += [cuts[i - 1][2]["text"], ""]
        inside = lambda f: lo_y <= f["t"] - (line_h // 2 if f in left else 0) < hi_y
        titles = sorted([f for f in left if inside(f) and f is not (cuts[i - 1][2] if i else None)] +
                        ([cuts[i - 1][2]] if i and cuts[i - 1][1] == "head" else []), key=lambda f: f["t"])
        if i and cuts[i - 1][1] == "head":
            # the title wraps over several short right-aligned lines: one line, so it stays a title
            text = ""
            for f in titles:
                first = f["text"].split()[0]
                if text and re.match(r"\s*\d{3}", f["text"]):
                    out.append(text)  # another course's number: never part of this title
                    text = f["text"]
                elif text.endswith("-"):
                    text = text[:-1] + f["text"]
                elif text and first.islower() and len(first) <= 3 and first not in SMALL | {"by", "with"}:
                    text += f["text"]  # "Music and Literatu" + "re 2": a word split by the column
                else:
                    text = (text + " " + f["text"]).strip()
            out.append(text)
        else:
            emit(titles)
        out.append("")
        emit([f for f in right if inside(f)])
        out.append("")
    return "\n".join(out)


def page_lines(text):
    """Lines of one page, running heads dropped from the top and bottom, blank lines kept."""
    lines = [ln.rstrip() for ln in text.replace("\f", "").split("\n")]
    for edge in (range(0, min(6, len(lines))), range(len(lines) - 1, max(len(lines) - 4, -1), -1)):
        for i in edge:
            if lines[i].strip() and RUNNING.match(lines[i]):
                lines[i] = ""
    return lines


# --------------------------------------------------------------------------
# Paragraphs
# --------------------------------------------------------------------------

LABELS = {"prereq": "Prereq", "antireq": "Antireq", "coreq": "Coreq", "prerequisite": "Prerequisite",
          "prerequisites": "Prerequisites", "corequisite": "Corequisite", "antirequisite": "Antirequisite"}


def fix_label(para):
    """'Antireg:' / 'Preraq:' / 'Preregq:' -> the word the calendar printed."""
    m = re.match(r"^([A-Za-z]{4,14})\s?:", para)
    if not m:
        return para
    word = m.group(1).lower()
    best = min(LABELS, key=lambda k: ip.ocr_distance(word, k))
    if word != best and ip.ocr_distance(word, best) <= 1.5 and abs(len(word) - len(best)) <= 1:
        return LABELS[best] + para[m.end(1):]
    return para


def paragraphs(lines):
    """Blank-line separated paragraphs; wrapped lines joined, hyphenated words rejoined."""
    out, cur = [], ""
    for ln in lines + [""]:
        s = ln.strip()
        if not s:
            if cur:
                # "3 lectures, ©" / "2 lectures, ." -> "3 lectures." (specks from the scan)
                cur = re.sub(r"[,;:]?\s*[^\w\s()\"\u2019']{1,3}$|,$", ".", cur) if re.search(r"[,;:]\s*\W{0,3}$", cur) else cur
                out.append(fix_label(cur))
            cur = ""
            continue
        if not cur:
            cur = s
        elif re.search(r"[a-z]-$", cur) and re.match(r"[a-z]", s):
            cur = cur[:-1] + s  # "sup-" + "ported"
        else:
            cur += " " + s
    return out


def title_like(s):
    """A line of a bold course title: mostly capitalised words, no sentence end. A title's first
    letter is always a capital, so an OCR slip there ("lconography", "integer Programming") counts."""
    s = re.sub(r"^(\s*)([a-z])", lambda m: m.group(1) + m.group(2).upper(), s)
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'-]*", s) if len(w) > 3]
    if not words or s.rstrip().endswith((".", ":", ";")) or re.match(r"(?i)(prereq|antireq|coreq)", s.strip()):
        return False
    if re.search(r"[a-z]{2}\.\s+[A-Z]", s):
        return False  # a sentence ends inside it: "Review of ac circuits. Three-phase ..."
    return sum(w[0].isupper() for w in words) / len(words) >= 0.6


def clean_spec(s):
    """'F.WS 3C 0.5' / 'FW,S 3C 0.5' -> 'F,W,S 3C 0.5'. Terms are only ever F, W, S, comma-separated."""
    s = re.sub(r"\s{2,}", " ", s.strip())
    m = re.match(r"^([FWS][FWSfws.,$\\|]{0,6})(?=\s|$)", s)  # "S$", "F\\W", "Ww" are OCR slips; "W,S/F,W" is real
    if m:
        s = ",".join(dict.fromkeys(re.findall("[FWS]", m.group(1).upper()))) + s[m.end():]
    # units with the point lost or misread: "05" / "0:5" -> "0.5", "025" -> "0.25"
    s = re.sub(r"(?:(?<=\s)|^)0[:;,]?(5|25|75)$", r"0.\1", s)
    return s


# --------------------------------------------------------------------------
# Subjects
# --------------------------------------------------------------------------


# 1963-64 keys that are old names for the same subject (the index points both at one page).
NAMED_ALIASES = {"CE": "CIVE", "EE": "ECE", "GEOLOGY": "EARTH"}


def subject_groups(index, era):
    """[(page, lead, [aliases])] in page order, one per subject. Aliases are other keys for the same
    subject: today's codes (AMATH for AM) and 1963-64 name keys (CE for CIVE)."""
    subjects = {k: v for k, v in index.items() if k != "_courses" and not re.search(r"\d", k)}
    alias_of = {today: printed for printed, (today, _) in ip.ALIASES.items() if printed in subjects}
    alias_of.update({k: v for k, v in NAMED_ALIASES.items() if v in subjects})
    groups = {}
    for k in subjects:
        groups.setdefault(alias_of.get(k, k), []).append(k)
    out = []
    for lead, keys in groups.items():
        out.append((min(subjects[k] for k in keys), lead, sorted(k for k in keys if k != lead)))
    out.sort(key=lambda g: (g[0], g[1]))
    return out


def subject_name(key, heading=None):
    if heading:
        return heading
    return ip.SUBJECT_NAMES.get(key, key.title())


def heading_line(lines, names):
    """Index of a line that is one of `names` (a section heading), or None."""
    want = {ip.letters(n) for n in names if n}
    for i, ln in enumerate(lines):
        t = ip.letters(re.sub(r"(?i)^\s*((undergraduate\s+)?course\s+descriptions?\W*|(department|school)\s+of\s+(the\s+)?)",
                              "", ln))
        if len(t) >= 4 and any(t == w or (len(w) > 6 and abs(len(t) - len(w)) <= 1 and ip.ratio(t, w) > 0.88)
                               for w in want):
            return i
    return None


DEPT_HEADINGS = {}
for _d in ip.DEPARTMENTS + ip.EARLY_DEPTS:
    if _d["keys"]:
        DEPT_HEADINGS.setdefault(_d["keys"][0], []).extend(_d["match"])
    for _k, _names in _d.get("subs", []):
        DEPT_HEADINGS.setdefault(_k, []).extend(_names)


def names_for(key, aliases=(), dept=None):
    """Headings a subject's section can start with."""
    names = [ip.SUBJECT_NAMES.get(k, "") for k in [key, *aliases]] + ip.HEADINGS.get(key, [])
    names += DEPT_HEADINGS.get(key, []) + [k for k in [key, *aliases] if len(k) > 4]  # BOTANY, GEOLOGY
    return [n for n in names + ([dept] if dept else []) if n]


SMALL = {"and", "of", "the", "in", "for", "to", "a", "an", "on"}


def heading_text(line):
    """'GERMAN AND RUSSIAN' -> 'German and Russian'; mixed case kept as printed.
    'Department of Biology' -> 'Biology'; scan specks at either end ('* Pure Mathematics', 'Dance ;') dropped."""
    t = re.sub(r"\s+", " ", line)
    t = re.sub(r"^[^A-Za-z(]+|[^A-Za-z)]+$", "", t)
    t = re.sub(r"(?i)^((undergraduate\s+)?course\s+descriptions?\W*|(the\s+)?(department|school)\s+of\s+(the\s+)?)", "", t)
    t = t.replace("Political: ", "Political ").strip("()")
    t = re.sub(r"(?i)^(of|faculty of)\s+", "", t)
    t = re.sub(r"(?<=[a-z])\.(?= [A-Z])", "", t)  # "Systems. Design" (speck)
    # trailing specks read as letters: "Management Sciences ote", "Religious Studies «ss"
    words = t.split(" ")
    while len(words) > 1 and (re.search(r"[^A-Za-z'\u2019-]", words[-1]) or
                              (len(words[-1]) <= 3 and words[-1].islower() and words[-1] not in SMALL)):
        words.pop()
    t = " ".join(words).strip(" .:-")
    t = t.strip(" .:-")
    if t.upper() != t:
        return t
    t = re.sub(r"(?<=[A-Z])\.(?=\s)", "", t)  # "CIVIL. ENGINEERING" (OCR speck)
    words = t.lower().split(" ")
    return " ".join(w if (i and w in SMALL) else w[:1].upper() + w[1:] for i, w in enumerate(words))


# --------------------------------------------------------------------------
# Coded era (1977-78 on): every course starts with "CS 241 F,W,S 3C 0.5"
# --------------------------------------------------------------------------


NOT_OFFERED = re.compile(r"(?i)^(courses?\s+not\s+offered|not\s+offered\s+in)\b.{0,40}$")


# OCR quirks at the start of a header line: "_GER 442", "LAT.361 F 3C", "CIV E 203: F,W 2C"
HEAD_FIX = [(re.compile(r"^[_|'\u2018\u2019.,\s]+(?=[A-Z])"), ""),
            (re.compile(r"^([A-Z][A-Z&]{0,5}(?: [A-Z]{1,2})?)\.(\d{3})"), r"\1 \2"),
            (re.compile(r"^([A-Z][A-Z&]{0,5}(?: [A-Z]{1,2})? ?\d{3}[A-Z]{0,2})\s?:(?=\s?[FWS])"), r"\1")]


# a lower-case suffix read as a digit: "MATH 1344" is 134a, "MATH 1346" / "1348" is 134b
SUFFIX_DIGIT = re.compile(r"^([A-Z][A-Z&]{0,5}(?: [A-Z]{1,2})? ?\d{3})([468])(?=\s+[FWSJ]|\s+\d[CLTS])")


# 1977-82 mixed-case headers: "Hist 204B Ww 5" (units ".5" lost their point), "$Soc310 F 2c 5",
# "Eng!480J", "C &0457a"
MIXED_HEAD = re.compile(r"^([A-Z][A-Za-z&! ]{0,7}?)\s?(\d{3}[A-Za-z]{0,2})(\s+)([FWSfws][FWSfws,.]{0,5})(?=\s|$)(.*)$")


def fix_head(ln):
    ln = re.sub(r"^[$\s]+|(?<=[A-Za-z])\$(?=\s?\d)", "", ln)
    ln = re.sub(r"^C\s?&\s?[0O](?=\s?\d)", "C&O ", ln)
    ln = re.sub(r"^Eng!", "Engl", ln)
    for rx, rep in HEAD_FIX:
        ln = rx.sub(rep, ln)
    m = MIXED_HEAD.match(ln)
    if m:
        terms = ",".join(dict.fromkeys(m.group(4).upper().replace(",", "").replace(".", "")))
        rest = re.sub(r"(?<=\s)\.?(5|25|75)$", r"0.\1", m.group(5))
        ln = "%s %s%s%s%s" % (m.group(1).rstrip(), m.group(2), m.group(3), terms, rest)
    return SUFFIX_DIGIT.sub(lambda m: m.group(1) + ("a" if m.group(2) == "4" else "b"), ln)


def split_coded(pages, index, year):
    lo, hi = min(pages), max(pages)
    pages = {p: [fix_head(ln) for ln in ls] for p, ls in pages.items()}
    groups = subject_groups(index, "coded")
    lead = {k: g[1] for g in groups for k in [g[1], *g[2]]}
    codes = {g[1] for g in groups} | {k for g in groups for k in g[2] if k not in ip.TODAY_ONLY}
    # full/titled: a description follows. list: "ACTSC 222 Contingencies" in a "not offered" list.
    heads = [h for h in ip.coded_candidates(pages, lo, hi, codes, ip.OCR_CODES) if h["kind"] in ("full", "titled", "list")]
    starts = {(h["page"], h["line"]): h for h in heads}

    # Section headings ("Computer Science" in large type) start a subject's notes.
    heading_at = {}
    for page, key, aliases in groups:
        for p in (page - 1, page, page + 1):
            if p in pages:
                i = heading_line(pages[p], names_for(key, aliases))
                if i is not None:
                    heading_at[(p, i)] = key
                    break

    subjects = {g[1]: dict(code=g[1], aliases=g[2], name=subject_name(g[1]), page=g[0], intro=None, courses=[])
                for g in groups}
    st = dict(cur=None, buf=[], intro_page=None, listed_note=None)

    def take_list_heading(paras):
        """A trailing 'COURSES NOT OFFERED 1994-95' belongs to the listed courses after it."""
        if paras and NOT_OFFERED.match(paras[-1]):
            st["listed_note"] = paras.pop().strip()
        return paras

    def flush():
        if st["cur"] is None:
            return
        key, entry = st["cur"]
        subj = subjects[key]
        if entry == "intro":
            paras = take_list_heading(paragraphs(st["buf"]))
            # the OCR sometimes reads the large heading twice
            while paras and ip.letters(paras[0]) in {ip.letters(n) for n in names_for(key, subj["aliases"])}:
                paras.pop(0)
            if paras:
                subj["intro"] = dict(page=st["intro_page"], paras=(subj["intro"] or {}).get("paras", []) + paras)
            return
        body = list(st["buf"])
        while body and not body[0].strip():
            body.pop(0)
        # units or a note wrapped onto the next line ("0.5", "(alt. weeks)") belong to the spec
        while body and not entry.get("listed") and re.fullmatch(r"\s*(\d\.\d{1,2}|\([^)]{1,25}\))\s*", body[0]):
            entry["spec"] = (entry["spec"] + " " + body.pop(0).strip()).strip()
            while body and not body[0].strip():
                body.pop(0)
        title = [entry["title"]] if entry["title"] else []
        if body and not title:
            # "Outdoor Education . The present status..." (title and description on one line)
            m = re.match(r"^(.{3,80}?)\s+[.;]\s+(\S.*)$", body[0].strip())
            if m and title_like(m.group(1)):
                title, body[0] = [m.group(1)], m.group(2)
            # "Introduction to Acting." (a speck after the title): a short capitalised line
            elif (len(body[0].strip()) <= 70 and title_like(body[0].strip().rstrip(" .;:,-")) and
                  not ip.HEADER_RE.match(body[0]) and (len(body) < 2 or not body[1].strip() or
                                                          not title_like(body[1]))):
                title = [body.pop(0).strip().rstrip(" .;:,-")]
        while body and len(title) < 3 and title_like(body[0]) and not ip.HEADER_RE.match(body[0]):
            title.append(body.pop(0).strip())
        entry["title"] = re.sub(r"\s+", " ", " ".join(title)).strip()
        if entry["title"][:1].islower():
            entry["title"] = {"l": "I"}.get(entry["title"][0], entry["title"][0].upper()) + entry["title"][1:]
        entry["paras"] = take_list_heading(paragraphs(body))

    for p in range(lo, hi + 1):
        for i, ln in enumerate(pages[p]):
            if (p, i) in heading_at:
                flush()
                st.update(cur=(heading_at[(p, i)], "intro"), buf=[], intro_page=p, listed_note=None)
                continue
            h = starts.get((p, i))
            if h:
                flush()
                key = lead.get(h["key"], h["key"])
                m = ip.HEADER_RE.match(ln)
                rest = m.group("rest").strip() if m else ""
                num = h["nums"][0].rstrip("?")
                entry = dict(id=key + num, label="%s %s" % (key, num), page=p, spec="", title="", paras=[])
                if h["kind"] == "list":
                    entry.update(title=rest, listed=st["listed_note"] or "Listed without a description")
                else:
                    entry["spec"] = clean_spec(rest)
                    st["listed_note"] = None
                subjects[key]["courses"].append(entry)
                st.update(cur=(key, entry), buf=[])
                continue
            st["buf"].append(ln)
    flush()

    # One anchor per course: a full description wins over a listing of the same code.
    for subj in subjects.values():
        full = {c["id"] for c in subj["courses"] if not c.get("listed")}
        seen = set()
        for c in subj["courses"]:
            if c["id"] in seen or (c.get("listed") and c["id"] in full):
                c["id"] = None
            else:
                seen.add(c["id"])
    return [s for s in subjects.values() if s["courses"] or s["intro"]]


# --------------------------------------------------------------------------
# Named era (1963-64 to 1976-77): "235. Physical Chemistry I. An introduction..."
# --------------------------------------------------------------------------

NAMED_ENTRY = re.compile(r"^\s*(\d{1,3}(?:-\d{1,3})?[A-Za-z]?)\*?\s?\.\s+(?=[A-Z(\u2018'\"{])")  # "235." "100J." "1-50."


def split_named(pages, index, year, cfg):
    lo, hi = min(pages), max(pages)
    pages = {p: [J_FIX.sub(r"\1J", ln) for ln in ls] for p, ls in pages.items()}
    groups = subject_groups(index, "named")
    # A department whose subjects all start on the same page that year is one section (1970-75
    # Mathematics with CS, CO, STAT...): the others are aliases of its lead, so a "Department of
    # Statistics" line in its staff list can't start a section of its own.
    page_of = {g[1]: g[0] for g in groups}
    for d in ip.DEPARTMENTS + list(cfg.get("extra_depts") or []):
        ks = [k for k in d["keys"] if k in page_of]
        if len(ks) > 1 and len({page_of[k] for k in ks}) == 1:
            lead, rest = ks[0], set(ks[1:])
            merged = [a for g in groups if g[1] in rest for a in [g[1], *g[2]]]
            groups = [(g[0], g[1], sorted(set(g[2]) | set(merged)) if g[1] == lead else g[2])
                      for g in groups if g[1] not in rest]
    # A forced department start ("classics" on p. 117) names its own lead subject only, not Greek
    # and Latin starting on the same page.
    leads = {}
    for d in ip.DEPARTMENTS + ip.EARLY_DEPTS + list(cfg.get("extra_depts") or []):
        for m in d["match"]:
            if d["keys"]:
                leads.setdefault(m, d["keys"][0])
    dept_of = {}
    for page, name in (cfg.get("dept_starts") or {}).items():
        on_page = [g[1] for g in groups if g[0] == page]
        lead = leads.get(name)
        dept_of[lead if lead in on_page else (on_page[0] if len(on_page) == 1 else None)] = name
    # named_candidates (index_pdf) knows the 1964-77 header forms: "132 Principles of Biology",
    # "236* Ecology 1", "100J. Title", "AM 481 Title"; long list-style lines carry a description
    cands = {}
    for p in range(lo, hi + 1):
        for c in ip.named_candidates(pages[p], p):
            # a row of a renumbering or course table ("Math 340 b  CS 342  Math 445 a  AM 466")
            # holds several course numbers; a header holds one
            if len(re.findall(r"(?<![\d.])\d{3}(?![\d.])", c["text"])) >= 3:
                continue
            if c["kind"] == "full" or len(c["text"]) >= 38:
                cands[(p, c["line"])] = c
    bounds, missed = [], []
    for page, key, aliases in groups:
        names = names_for(key, aliases, dept_of.get(key))
        found = None
        for p in (page, page + 1):  # the index's page can be one early for a subsection
            i = heading_line(pages.get(p, []), names)
            if i is not None:
                found = (p, i)
                break
        if found is None:
            missed.append(key)
            # unreadable heading: the department's staff list starts it ("D. J. Pugliese, B.A. ... /
            # Assistant Professor and Chairman of the Department"); start at that block
            ls = pages.get(page, [])
            chair = next((i for i, ln in enumerate(ls) if re.search(r"(?i)chairman\s+of\s+the\s+department", ln)), None)
            if chair is not None:
                i = chair
                while i > 0 and ls[i - 1].strip():
                    i -= 1
                found = (page, i - 1) if i > 0 else None
        p, i = found or (page, 0)
        name = heading_text(pages[p][i]) if found and key not in missed else ""
        own_names = {ip.letters(n) for k in [key, *aliases] for n in [ip.SUBJECT_NAMES.get(k, ""), k]
                     + ip.HEADINGS.get(k, []) + DEPT_HEADINGS.get(k, [])} | (
                     {ip.letters(dept_of[key])} if key in dept_of else set())
        if not name or not name[0].isupper() or ip.letters(name) not in own_names:
            # the heading found was an alias's ("Computer Science" in Mathematics), a speck, or a
            # near-miss ("Chemcial Engineering"): the subject's standard name
            name = ip.SUBJECT_NAMES.get(key, key.title())
        bounds.append((p, i, key, aliases, name))
    bounds.sort(key=lambda b: (b[0], b[1]))
    # A subject with no heading of its own that shares its index page with one that has a heading
    # (CS, CO, STAT pointing at 1975-76 Mathematics) is the same section: make it an alias.
    found_at = {}
    for b in bounds:
        if b[2] not in missed:
            found_at.setdefault(min(g[0] for g in groups if g[1] == b[2]), b)
    merged = []
    for b in bounds:
        page0 = next(g[0] for g in groups if g[1] == b[2])
        host = found_at.get(page0)
        if b[2] in missed and host is not None:
            host[3].append(b[2])
            missed.remove(b[2])
            continue
        merged.append(b)
    bounds = merged
    if missed:
        print("  no heading found for %s; they start at the top of their index page" % ", ".join(missed),
              file=sys.stderr)

    out = []
    for n, (page, line, key, aliases, name) in enumerate(bounds):
        end = bounds[n + 1][:2] if n + 1 < len(bounds) else (hi + 1, 0)
        stream = []
        for p in range(page, min(end[0], hi) + 1):
            ls = pages.get(p, [])
            a = line + 1 if p == page else 0  # the heading itself is the page title
            b = end[1] if p == end[0] else len(ls)
            stream += [(p, i, ls[i]) for i in range(a, b)]
        subj = dict(code=key, aliases=sorted(aliases), name=name, page=page, intro=None, courses=[],
                    _pos=(page, line))
        # Canadian Studies pages list other departments' Canadian-content courses: only the
        # programme's own core courses carry its code
        only = next((d.get("only_courses") for d in ip.DEPARTMENTS if d["keys"][:1] == [key]), None)
        state = dict(cur=None, buf=[])

        def flush():
            cur, buf = state["cur"], state["buf"]
            text = paragraphs([ln for _, ln in buf])
            if cur is None:
                if text:
                    subj["intro"] = dict(page=page, paras=text)
                return
            if cur.pop("_bare", False):
                # no printed title: the description's first sentence stands in for it
                text = paragraphs([ln for _, ln in buf])
                first = text[0] if text else ""
                mm = re.match(r"^(.{3,90}?[a-z)])\.\s+(.*)$", first)
                cur["title"], rest = (mm.group(1), mm.group(2)) if mm else (first.rstrip("."), "")
                cur["paras"] = ([rest] if rest else []) + text[1:]
                note(cur)
                cur.pop("_style", None)
                return
            if cur.pop("_style", None) == "line":
                # "132 Principles of Biology" on its own line(s); the description follows
                lines = [ln for _, ln in buf]
                while lines and not lines[0].strip():
                    lines.pop(0)
                title = [lines.pop(0).strip()] if lines else []
                while (lines and lines[0].strip() and title_like(lines[0]) and len(" ".join(title)) < 90
                       and not NAMED_ENTRY.match(lines[0])):
                    title.append(lines.pop(0).strip())
                t = re.sub(r"\s+", " ", " ".join(title)).strip(" \u2018\u2019'\"")
                cur["title"], cur["paras"] = t, paragraphs(lines)
                note(cur)
                return
            first = text[0] if text else ""
            # "Physical Chemistry I. An introduction..." -> title, description
            m = re.match(r"^(.{3,160}?(?:[^A-Z.\s]|\s[IVX]{1,4}))\.\s+(.*)$", first)
            cur["title"], rest = (m.group(1), m.group(2)) if m else (first.rstrip("."), "")
            cur["title"] = cur["title"].strip(" \u2018\u2019'\"")
            rest = rest.lstrip(" \u2018\u2019'\"")
            cur["paras"] = ([rest] if rest else []) + text[1:]
            note(cur)

        def note(cur):
            """'Secondary Analysis of Survey Data Not offered 1975-76' -> title + the site's not-offered note."""
            m = re.search(r"[\s(]*\bnot\s+offered\b[^.]*\.?\)?$", cur["title"], re.I)
            if m and m.start() > 3:
                cur["listed"] = cur["title"][m.start():].strip(" ()")
                cur["title"] = cur["title"][:m.start()].strip()
            elif cur["paras"] and re.fullmatch(r"(?i)\(?not\s+offered\b.{0,30}", cur["paras"][0]) and len(cur["paras"]) <= 2:
                cur["listed"] = cur["paras"].pop(0).strip(" ()")

        for p, i, ln in stream:
            m = NAMED_ENTRY.match(ln)
            c = cands.get((p, i))
            b = re.match(r"^\s*(\d{3}[A-Za-z]{0,2})\s*[*\u2019'\u201d\".]?\s*\u00a7\s*$", ln) if not m else None
            if b:
                flush()
                cur = dict(id=key + b.group(1).upper(), label="%s %s" % (key, b.group(1).upper()), page=p,
                           spec="", title="", paras=[], _style="line", _bare=True)
                subj["courses"].append(cur)
                state.update(cur=cur, buf=[])
                continue
            r = RANGE_HEAD.match(ln) if not m else None
            if r:
                flush()
                end = r.group(2) or "(%s-%s)" % (r.group(3), r.group(4))
                cur = dict(id=key + r.group(1), label="%s %s\u2013%s" % (key, r.group(1), end) if r.group(2)
                           else "%s %s%s" % (key, r.group(1), end), page=p, spec="", title="", paras=[], _style="line")
                subj["courses"].append(cur)
                state.update(cur=cur, buf=[(p, ln[r.end():])])
                continue
            if m or c:
                flush()
                code_key = key
                if m:
                    num, rest = m.group(1).upper(), ln[m.end():]
                else:
                    nm = ip.NAMED_RE.match(ln)
                    num, rest = c["nums"][0], nm.group("rest")
                    if c["pfx"]:  # "AM 481", "ISS 320R*": the printed code, when it's a known one
                        code_key = ip.NAMED_PREFIXES.get(ip.letters(c["pfx"]), key)
                # anchors are always under this subject's own code (an alias's course is the
                # same course); a course printed with another subject's code moves to that
                # subject's page afterwards, or gets no anchor if the year has none
                own = code_key == key or code_key in aliases
                cur = dict(id=key + num if own else None, label="%s %s" % (code_key, num), page=p,
                           spec="", title="", paras=[], _style="period" if m else "line")
                if only and own and not re.fullmatch(only, re.sub(r"[A-Z]+$", "", num)):
                    cur.update(id=None, label=num)
                if not own:
                    cur["_route"] = (code_key, num)
                subj["courses"].append(cur)
                state.update(cur=cur, buf=[(p, rest)])
                continue
            state["buf"].append((p, ln))
        flush()
        out.append(subj)
    # "Math 210" printed in the Statistics pages (1976-77's Mathematics Service Courses) belongs
    # on the Mathematics page
    owner = {}
    for s in out:
        for k in [s["code"], *s["aliases"]]:
            owner.setdefault(k, s)
    for s in out:
        for c in list(s["courses"]):
            route = c.pop("_route", None)
            if route and route[0] in owner and owner[route[0]] is not s:
                dest = owner[route[0]]
                c["id"] = dest["code"] + route[1]
                s["courses"].remove(c)
                dest["courses"].append(c)
    for s in out:
        # One anchor per course number: the entry with the most text wins (course tables and
        # cross-references repeat numbers without a description).
        best = {}
        for c in s["courses"]:
            size = len(c["title"]) + sum(len(x) for x in c["paras"])
            if c["id"] and (c["id"] not in best or size > best[c["id"]][0]):
                best[c["id"]] = (size, c)
        for c in s["courses"]:
            if c["id"] and best[c["id"]][1] is not c:
                c["id"] = None
    # A subject that came out empty but shares its index page with one that has courses (a staff
    # list's "Department of Computer Science" inside 1975-76 Mathematics) is an alias of it.
    page_of = {g[1]: g[0] for g in groups}
    # no heading and no courses: probably not a section of its own (1966-67 "Science" is Mechanical
    # Engineering's notes); drop it so its subject falls back to the PDF, and give its text back
    for s in [s for s in out if not s["courses"] and s["code"] in missed]:
        i = out.index(s)
        if i and s["intro"]:
            prev = out[i - 1]
            tail = prev["courses"][-1] if prev["courses"] else None
            if tail is not None:
                tail["paras"] += s["intro"]["paras"]
        out.remove(s)
    for s in [s for s in out if not s["courses"]]:
        host = next((h for h in out if h["courses"] and page_of[h["code"]] == page_of[s["code"]]), None)
        # a department heading above its subsections (1963-64 Classics over Greek and Latin) keeps
        # its own page; one found after its host's heading (a staff list) does not
        if host and s["_pos"] > host["_pos"]:
            host["aliases"] = sorted(set(host["aliases"]) | {s["code"]} | set(s["aliases"]))
            out.remove(s)
    for s in out:
        s.pop("_pos", None)
    return out


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--year", help="YYyy, if the file name doesn't say")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    ap.add_argument("--out", help="default: data/archive-text/{YYyy}.json")
    args = ap.parse_args()

    year = ip.year_key(args.pdf, args.year)
    cfg = ip.YEARS.get(year) or sys.exit("no YEARS entry for %s in index_pdf.py" % year)
    with open(os.path.join(ROOT, "data", "archive", "%s.json" % year), encoding="utf-8") as f:
        index = json.load(f)
    lo, hi = cfg["section"]
    print("%s: OCR pages %d-%d (%s era)" % (year, lo, hi, cfg["era"]), file=sys.stderr)
    cache = os.path.join(ROOT, ".cache", "ocr", year)
    raw = ocr_section(args.pdf, lo, hi, cache, args.workers, need_tsv=year in SIDE_BY_SIDE)
    if year in SIDE_BY_SIDE:
        for p in raw:
            rebuilt = side_by_side_lines(os.path.join(cache, "p%04d.tsv" % p))
            if rebuilt is not None:
                raw[p] = rebuilt
    pages = {p: page_lines(t) for p, t in raw.items()}

    subjects = split_coded(pages, index, year) if cfg["era"] == "coded" else split_named(pages, index, year, cfg)
    start = 1900 + int(year[:2]) if int(year[:2]) >= 57 else 2000 + int(year[:2])
    version = subprocess.run(["tesseract", "--version"], capture_output=True, text=True).stdout.split("\n")[0]
    doc = dict(year=year, label="%d–%s" % (start, year[2:]),
               pdf="http://www.ucalendar.uwaterloo.ca/6394/%d-%s.pdf" % (start, year[2:]),
               ocr="%s, 300 dpi" % version.strip(), subjects=subjects)
    out = args.out or os.path.join(ROOT, "data", "archive-text", "%s.json" % year)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=0, separators=(",", ":"))
        f.write("\n")
    n = sum(len(s["courses"]) for s in subjects)
    print("%s: %d subjects, %d course entries -> %s" % (year, len(subjects), n, os.path.relpath(out, ROOT)),
          file=sys.stderr)


if __name__ == "__main__":
    main()
