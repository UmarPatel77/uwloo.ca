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


def ocr_page(pdf, page, cache):
    out = os.path.join(cache, "p%04d" % page)
    if not (os.path.exists(out + ".txt") and os.path.getsize(out + ".txt") > 0):
        subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", "-f", str(page), "-l", str(page),
                        "-singlefile", pdf, out], check=True)
        env = dict(os.environ, OMP_THREAD_LIMIT="1")  # threads only add overhead per page
        subprocess.run(["tesseract", out + ".png", out, "--psm", "3"], check=True, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(out + ".png")
    with open(out + ".txt", encoding="utf-8") as f:
        return f.read()


def ocr_section(pdf, lo, hi, cache, workers):
    os.makedirs(cache, exist_ok=True)
    pages = {}
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        jobs = {pool.submit(ocr_page, pdf, p, cache): p for p in range(lo, hi + 1)}
        for n, job in enumerate(concurrent.futures.as_completed(jobs), 1):
            pages[jobs[job]] = job.result()
            if n % 25 == 0 or n == len(jobs):
                print("  OCR %d/%d" % (n, len(jobs)), file=sys.stderr)
    return pages


# --------------------------------------------------------------------------
# Lines
# --------------------------------------------------------------------------

# Running heads and folios: "Course Descriptions", "16:34", "COURSE DESCRIPTION", "-- 112 --".
RUNNING = re.compile(r"(?i)^\s*(course\s+desc\w*|curricula\s+and\s+courses\s+of\s+study|courses\s+of\s+instruction"
                     r"|undergraduate\s+calendar|[-—\s]*\d{1,3}\s*[:;.]?\s*\d{0,3}[-—\s]*|[ivxl]{1,5})\s*$")


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
    """A line of a bold course title: mostly capitalised words, no sentence end."""
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'-]*", s) if len(w) > 3]
    if not words or s.rstrip().endswith((".", ":", ";")) or re.match(r"(?i)(prereq|antireq|coreq)", s.strip()):
        return False
    return sum(w[0].isupper() for w in words) / len(words) >= 0.6


def clean_spec(s):
    """'F.WS 3C 0.5' / 'FW,S 3C 0.5' -> 'F,W,S 3C 0.5'. Terms are only ever F, W, S, comma-separated."""
    s = re.sub(r"\s{2,}", " ", s.strip())
    m = re.match(r"^([FWS][FWS.,$\\|]{0,6})(?=\s|$)", s)  # "S$", "F\\W" are OCR slips; "W,S/F,W" is real
    if m:
        s = ",".join(dict.fromkeys(re.findall("[FWS]", m.group(1)))) + s[m.end():]
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
        t = ip.letters(re.sub(r"(?i)^\s*(department|school)\s+of\s+(the\s+)?", "", ln))
        if len(t) >= 4 and any(t == w or (len(w) > 6 and ip.ratio(t, w) > 0.88) for w in want):
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
    """'GERMAN AND RUSSIAN' -> 'German and Russian'; mixed case kept as printed."""
    t = re.sub(r"\s+", " ", line).strip(" .:-")
    if t.upper() != t:
        return t
    t = re.sub(r"(?<=[A-Z])\.(?=\s)", "", t)  # "CIVIL. ENGINEERING" (OCR speck)
    words = t.lower().split(" ")
    return " ".join(w if (i and w in SMALL) else w[:1].upper() + w[1:] for i, w in enumerate(words))


# --------------------------------------------------------------------------
# Coded era (1977-78 on): every course starts with "CS 241 F,W,S 3C 0.5"
# --------------------------------------------------------------------------


NOT_OFFERED = re.compile(r"(?i)^(courses?\s+not\s+offered|not\s+offered\s+in)\b.{0,40}$")


def split_coded(pages, index, year):
    lo, hi = min(pages), max(pages)
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
        title = [entry["title"]] if entry["title"] else []
        while body and len(title) < 3 and title_like(body[0]) and not ip.HEADER_RE.match(body[0]):
            title.append(body.pop(0).strip())
        entry["title"] = re.sub(r"\s+", " ", " ".join(title)).strip()
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
    groups = subject_groups(index, "named")
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
        p, i = found or (page, 0)
        name = heading_text(pages[p][i]) if found else ip.SUBJECT_NAMES.get(key, key.title())
        bounds.append((p, i, key, aliases, name))
    bounds.sort(key=lambda b: (b[0], b[1]))
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
            stream += [(p, ln) for ln in ls[a:b]]
        subj = dict(code=key, aliases=aliases, name=name, page=page, intro=None, courses=[])
        state = dict(cur=None, buf=[])
        seen = set()

        def flush():
            cur, buf = state["cur"], state["buf"]
            text = paragraphs([ln for _, ln in buf])
            if cur is None:
                if text:
                    subj["intro"] = dict(page=page, paras=text)
                return
            first = text[0] if text else ""
            # "Physical Chemistry I. An introduction..." -> title, description
            m = re.match(r"^(.{3,160}?(?:[^A-Z.\s]|\s[IVX]{1,4}))\.\s+(.*)$", first)
            cur["title"], rest = (m.group(1), m.group(2)) if m else (first.rstrip("."), "")
            cur["title"] = cur["title"].strip(" \u2018\u2019'\"")
            rest = rest.lstrip(" \u2018\u2019'\"")
            cur["paras"] = ([rest] if rest else []) + text[1:]

        for p, ln in stream:
            m = NAMED_ENTRY.match(ln)
            if m:
                flush()
                num = m.group(1).upper()
                code = key + num
                cur = dict(id=code if code not in seen else None, label="%s %s" % (key, num), page=p,
                           spec="", title="", paras=[])
                seen.add(code)
                subj["courses"].append(cur)
                state.update(cur=cur, buf=[(p, ln[m.end():])])
                continue
            state["buf"].append((p, ln))
        flush()
        out.append(subj)
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
    raw = ocr_section(args.pdf, lo, hi, os.path.join(ROOT, ".cache", "ocr", year), args.workers)
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
