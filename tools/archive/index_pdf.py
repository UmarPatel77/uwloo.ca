#!/usr/bin/env python3
"""Build a page index for a scanned University of Waterloo undergraduate calendar.

    python tools/archive/index_pdf.py path/to/1985-86.pdf
    python tools/archive/index_pdf.py path/to/1985-86.pdf --report
    python tools/archive/index_pdf.py path/to/1985-86.pdf --sheet 300-330

Writes data/archive/{YYyy}.json, mapping keys to PHYSICAL page numbers (the
1-based page index in the PDF file, not the printed page number):

    { "_courses": 285, "ACC": 285, "ACC101": 286, ... }

  _courses        first page of the course-descriptions section (fallback)
  ACC, CS, ...    first page of a subject (the code as printed, spaces and &
                  removed), plus today's code when a subject was renamed
  ACC101, ...     page where that course's description starts

The router does pages["CS241"] || pages["CS"] || pages["_courses"].

Two layout eras are handled:

  named  (1960s-1970s) Courses have no letter codes ("334* The Flowering
         Plants"); departments are found from running heads and "Department
         of ..." headings and mapped to today's codes. Courses get keys only
         when their subject is unambiguous.
  coded  (1980s-1990s) Every description starts with a header line such as
         "CS 241 F,W,S 3C 0.5" (code, number, terms, hours, units).

Each year has an entry in YEARS: the era, the physical page range of the
course-descriptions section, and any manual fixes found while checking page
images. Requires poppler (pdftotext, pdftoppm). Pages with no text layer are
OCRed with tesseract if it is installed (cached in a temp folder). --sheet
needs Pillow.
"""

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict

KEY_RE = re.compile(r"^(_courses|[A-Z]{2,8}(\d{3}[A-Z]{0,2})?)$")

# --------------------------------------------------------------------------
# Subjects. Key -> name. Names are used for the alphabetical-order check and
# for recognising section headings. Keys are codes as printed in some year
# (spaces and & removed); a few are today's codes used as aliases.
# --------------------------------------------------------------------------
SUBJECT_NAMES = {
    "ACC": "Accounting", "ACTSC": "Actuarial Science", "AFM": "Accounting and Financial Management",
    "AM": "Applied Mathematics", "AMATH": "Applied Mathematics", "ANTH": "Anthropology",
    "ARCH": "Architecture", "ARTS": "Arts", "BIOL": "Biology", "BUS": "Business",
    "CCIV": "Classical Civilization", "CDNST": "Canadian Studies", "CHE": "Chemical Engineering",
    "CHEM": "Chemistry", "CHINA": "Chinese", "CIVE": "Civil Engineering", "CLAS": "Classical Studies",
    "CO": "Combinatorics and Optimization", "COMMST": "Communication Studies", "CROAT": "Croatian",
    "CS": "Computer Science", "DANCE": "Dance", "DRAMA": "Drama", "DUTCH": "Dutch",
    "EARTH": "Earth Sciences", "ECE": "Electrical and Computer Engineering", "ECON": "Economics",
    "ELE": "Electrical Engineering", "ENGL": "English", "ENVST": "Environmental Studies",
    "HRCS": "Human Relations and Counselling Studies", "ENVE": "Environmental Engineering",
    "ENVS": "Environmental Studies", "ERS": "Environment and Resource Studies", "FINE": "Fine Arts",
    "FR": "French", "GENE": "General Engineering", "GEOE": "Geological Engineering",
    "GEOG": "Geography", "GER": "German", "GERON": "Gerontology", "GRK": "Greek",
    "GSJ": "Gender and Social Justice", "HIST": "History", "HLTH": "Health Studies",
    "IFS": "Inter-Faculty Studies", "IS": "Independent Studies", "ISS": "Interdisciplinary Social Science",
    "ITAL": "Italian", "JAPAN": "Japanese", "KIN": "Kinesiology", "KOREA": "Korean", "LAT": "Latin",
    "MATH": "Mathematics", "ME": "Mechanical Engineering", "MENV": "Man-Environment Studies",
    "MSCI": "Management Sciences", "MTHEL": "Mathematics Electives", "MUSIC": "Music",
    "OPTOM": "Optometry", "PACS": "Peace and Conflict Studies",
    "PAS": "Personnel and Administrative Studies", "PERST": "Personality and Religion",
    "PHIL": "Philosophy", "PHYS": "Physics", "PLAN": "Planning", "PMATH": "Pure Mathematics",
    "POLSH": "Polish", "PORT": "Portuguese", "PSCI": "Political Science", "PSYCH": "Psychology",
    "REC": "Recreation", "RS": "Religious Studies", "RUSS": "Russian", "SCI": "Science",
    "SDS": "Social Development Studies", "SMF": "Society, Marriage and Family",
    "SOC": "Sociology", "SOCWK": "Social Work", "SPAN": "Spanish", "STAT": "Statistics",
    "STV": "Science, Technology and Values", "SYDE": "Systems Design Engineering",
    "UKRAN": "Ukrainian", "WS": "Women's Studies",
}

# Today's code for subjects whose code changed. with_courses=True also copies
# every course key (AM231 -> AMATH231), for renames that kept the numbering.
# Matches the conventions used in 9495.json.
ALIASES = {
    "AM": ("AMATH", True),
    "ACC": ("AFM", False),
    "ISS": ("SDS", False),
    "WS": ("GSJ", False),
    "ELE": ("ECE", True),
    "CCIV": ("CLAS", False),
    "MENV": ("ERS", False),
    "ENVST": ("ENVS", True),  # "Env St 200" (1977-82) became ENV S 200
}

# Codes that only exist as today's aliases (never printed in these calendars
# as course prefixes), so they are not matched as printed codes.
TODAY_ONLY = {"AMATH", "AFM", "SDS", "GSJ", "ERS", "ECE", "CLAS", "COMMST"}

# Extra heading names for finding where a subject's section starts.
HEADINGS = {
    "ACC": ["Accounting Group"], "DRAMA": ["Drama and Theatre Arts"],
    "ELE": ["Electrical Engineering"], "GER": ["Germanic and Slavic Languages and Literature",
    "Germanic and Slavic Languages"], "ISS": ["Social Development Studies"],
    "MENV": ["Man-Environment Studies"], "OPTOM": ["School of Optometry"],
    "PLAN": ["Urban and Regional Planning", "School of Urban and Regional Planning",
             "Planning, Urban and Regional"],
    "REC": ["Recreation and Leisure Studies"], "SYDE": ["Systems Design Engineering", "Systems Design"],
    "WS": ["Women's Studies"], "ECE": ["Electrical and Computer Engineering"],
}

# Names used for the alphabetical-order check, for subjects listed under a
# department or faculty heading rather than their own name.
SORT_NAMES = {
    "CCIV": "Classical Studies", "GRK": "Classical Studies 2", "LAT": "Classical Studies 3",
    "GER": "Germanic", "DUTCH": "Germanic 2", "RUSS": "Germanic 3", "POLSH": "Germanic 4",
    "UKRAN": "Germanic 5", "ACTSC": "Mathematics 1", "AM": "Mathematics 2",
    "CO": "Mathematics 3", "CS": "Mathematics 4", "MATH": "Mathematics 5",
    "MTHEL": "Mathematics 6", "PMATH": "Mathematics 7", "STAT": "Mathematics 8",
    "ISS": "Social Development Studies", "SOCWK": "Social Development Studies 2",
    "PLAN": "Urban and Regional Planning",
}

# --------------------------------------------------------------------------
# Named era: departments (as headed in the calendar) -> subject keys.
# match: lowercase names used in running heads / "Department of ..." lines.
# keys:  keys pointing at the department's first page.
# subs:  subsections with their own heading inside the department
#        (key, heading names). Pages between two subsection headings belong
#        to the earlier one; a page with both gets no course keys.
# prefixed_only: only courses printed with a prefix ("ISS 320R*") get keys.
# --------------------------------------------------------------------------
DEPARTMENTS = [
    dict(match=["arts"], keys=["ARTS"]),
    dict(match=["architecture", "school of architecture"], keys=["ARCH"]),
    dict(match=["biology"], keys=["BIOL"]),
    # its pages mostly list other departments' Canadian-content courses; only
    # the programme's own core courses get keys
    dict(match=["canadian studies"], keys=["CDNST"], only_courses=r"(201|202|300|400)"),
    dict(match=["chemical engineering"], keys=["CHE"]),
    dict(match=["chemistry"], keys=["CHEM"]),
    dict(match=["civil engineering"], keys=["CIVE"]),
    dict(match=["classics and romance languages", "classics"], keys=["CLAS"],
         subs=[("CLAS", ["classics", "classical studies", "classical civilization"]),
               ("GRK", ["greek"]), ("LAT", ["latin"]), ("FR", ["french"]),
               ("ITAL", ["italian"]), ("SPAN", ["spanish"]), ("PORT", ["portuguese"])]),
    dict(match=["communications studies programme", "communications studies"], keys=["COMMST"]),
    dict(match=["drama and theatre arts group", "drama and theatre arts", "drama"], keys=["DRAMA"]),
    dict(match=["earth sciences"], keys=["EARTH"]),
    dict(match=["economics"], keys=["ECON"]),
    dict(match=["electrical engineering"], keys=["ECE"]),
    dict(match=["english"], keys=["ENGL"]),
    dict(match=["environmental studies"], keys=["ENVS"]),
    dict(match=["fine arts"], keys=["FINE"],
         subs=[("FINE", ["fine arts"]), ("MUSIC", ["music", "course descriptions music"])]),
    dict(match=["general engineering"], keys=["GENE"]),
    dict(match=["geography"], keys=["GEOG"]),
    dict(match=["germanic and slavic languages and literature", "germanic and slavic languages"],
         keys=["GER"],
         subs=[("GER", ["german"]), ("RUSS", ["russian"]), ("UKRAN", ["ukrainian"]),
               ("POLSH", ["polish"]), ("DUTCH", ["dutch"])]),
    dict(match=["history"], keys=["HIST"]),
    dict(match=["human relations and counselling studies"], keys=[]),
    dict(match=["inter-faculty studies"], keys=["IFS"]),
    dict(match=["kinesiology"], keys=["KIN"],
         subs=[("KIN", ["kinesiology"]), ("HLTH", ["health studies"]), ("DANCE", ["dance"])]),
    dict(match=["man-environment studies"], keys=["ERS", "MENV"]),
    dict(match=["management sciences"], keys=["MSCI"]),
    dict(match=["mathematics"], keys=["MATH", "AMATH", "ACTSC", "CO", "CS", "PMATH", "STAT"]),
    dict(match=["mechanical engineering"], keys=["ME"]),
    dict(match=["optometry", "school of optometry"], keys=["OPTOM"]),
    dict(match=["philosophy"], keys=["PHIL"]),
    dict(match=["physics"], keys=["PHYS"]),
    dict(match=["political science"], keys=["PSCI"]),
    dict(match=["psychology"], keys=["PSYCH"]),
    dict(match=["recreation"], keys=["REC"]),
    dict(match=["religious studies"], keys=["RS"]),
    dict(match=["science"], keys=["SCI"]),
    dict(match=["social development studies", "social development"], keys=["SDS", "ISS"],
         subs=[("ISS", ["interdisciplinary social science"]), ("SOCWK", ["social work"])],
         prefixed_only=True),  # headers carry "ISS"/"Soc Wk"; the rest are other colleges' lists
    dict(match=["sociology and anthropology"], keys=["SOC"],
         subs=[("SOC", ["sociology"]), ("ANTH", ["anthropology"])]),
    dict(match=["systems design", "systems design engineering"], keys=["SYDE"]),
    dict(match=["urban and regional planning", "school of urban and regional planning"], keys=["PLAN"]),
    dict(match=["women's studies", "womens studies"], keys=["WS", "GSJ"]),
]

# Department names used only in the 1960s calendars. They are added for those
# years alone (YEARS[...]["extra_depts"]), because names like "French" are
# subsection headings in later years.
EARLY_DEPTS = [
    dict(match=["classics"], keys=["CLAS"]),
    dict(match=["french"], keys=["FR"]),
    dict(match=["german and russian"], keys=["GER"],
         subs=[("GER", ["german"]), ("RUSS", ["russian"])]),
    dict(match=["spanish and italian"], keys=["SPAN"],
         subs=[("SPAN", ["spanish"]), ("ITAL", ["italian"])]),
    dict(match=["sociology"], keys=["SOC"]),
    dict(match=["physical and health education"], keys=["KIN"]),
    dict(match=["design"], keys=["SYDE"]),
    dict(match=["geography and planning"], keys=["GEOG", "PLAN"]),
]

# Printed course prefixes seen inside named-era descriptions ("ISS 320R*",
# "Soc Wk 368R*"), normalised to letters only, lowercase.
NAMED_PREFIXES = {
    "iss": "ISS", "ifs": "IFS", "socwk": "SOCWK", "sotwk": "SOCWK", "suewk": "SOCWK",
    "wk": "SOCWK", "psych": "PSYCH",
    # 1976-77 Mathematics prints codes: "AM 481", "C&O 452a", "PMath 380a"
    "am": "AM", "co": "CO", "cs": "CS", "pmath": "PMATH", "stat": "STAT", "math": "MATH",
    "arts": "ARTS", "es": "ENVS", "rs": "RS", "sd": "SYDE",
}

# --------------------------------------------------------------------------
# Per-year settings. section = (first, last) physical pages of the course
# descriptions. Optional keys:
#   ocr_codes: {"OCR text": "KEY"} for code misreads fuzzy matching misses
#   dept_starts: {page: "department name"} forced named-era department starts
#   sub_starts: {"KEY": page} named-era subsection starts with no readable heading
#   no_depts: ["department name"] named-era departments detected by mistake
#   no_course_pages: [pages] named-era pages listing other departments' courses
#   subject_pages: {"KEY": page} final say on a subject's start page
#   course_pages: {"KEY123": page} courses the OCR lost
#   drop: [keys] remove keys that checks showed to be wrong
# --------------------------------------------------------------------------
YEARS = {
    # 1970-75: Sociology and Anthropology share a department. Its subsections
    # were placed from where the course numbers restart at 101 (Anthropology
    # first until 1973-74, Sociology first in 1974-75).
    # 1964-70: department headings with OCR damage are placed by hand; shared
    # departments are split where course numbers restart and a subject word
    # ("Anthropology", "Latin") heads the column
    # 1963-64: department starts as read off the page images for the original
    # 6364.json; shared departments (Biology/Botany/Zoology, Classics/Greek/Latin,
    # German/Russian, Romance Languages, Physics/Geology) get subject keys only
    "6364": dict(
        era="named", section=(100, 180),
        extra_depts=EARLY_DEPTS + [dict(match=["romance languages"], keys=["FR"])],
        dept_starts={102: "biology", 104: "chemical engineering", 107: "chemistry",
                     111: "civil engineering", 117: "classics", 119: "economics",
                     121: "electrical engineering", 127: "english", 132: "geography",
                     135: "german and russian", 140: "history", 143: "mathematics",
                     151: "mechanical engineering", 157: "philosophy", 161: "physics",
                     169: "political science", 172: "psychology", 174: "religious studies",
                     175: "romance languages", 179: "sociology"},
        subject_pages={"BOTANY": 103, "ZOOLOGY": 103, "GRK": 117, "LAT": 117, "CE": 111,
                       "EE": 121, "RUSS": 137, "EARTH": 168, "GEOLOGY": 168, "ITAL": 176,
                       "SPAN": 177},
        no_course_pages=list(range(102, 104)) + list(range(117, 119)) + list(range(135, 140))
        + list(range(168, 169)) + list(range(175, 179)),
        # Mathematics had no separate departments yet
        drop=["ACTSC", "AMATH", "CO", "CS", "PMATH", "STAT"],
        # keys from the original hand-checked 6364.json that the rules miss
        # (bare numbers like "421." in a range, unsuffixed PHIL/PSCI numbers)
        course_pages={
        "CHE699": 106, "ENGL235": 129, "GEOG421": 133, "GEOG422": 133, "GEOG423": 133,
        "GEOG424": 133, "GEOG425": 133, "GEOG426": 133, "GEOG427": 133, "GEOG428": 133,
        "GEOG429": 133, "GEOG456": 134, "HIST280": 141, "HIST615": 142, "HIST620": 142,
        "MATH614": 149, "MATH621": 149, "MATH624": 150, "MATH625": 150, "MATH631": 150,
        "MATH634": 150, "MATH641": 150, "MATH649": 150, "MATH654": 150, "MATH655": 150,
        "PHIL200": 157, "PHIL210": 158, "PHIL300": 158, "PHIL330": 159, "PSCI100": 169,
        "PSCI201": 169, "PSCI370": 170
        },
    ),
    "6465": dict(era="named", section=(100, 210), extra_depts=EARLY_DEPTS,
                 dept_starts={121: "classics"}),
    "6566": dict(era="named", section=(116, 244), extra_depts=EARLY_DEPTS,
                 dept_starts={117: "biology", 145: "economics"}),
    "6667": dict(era="named", section=(121, 275), extra_depts=EARLY_DEPTS,
                 dept_starts={122: "biology", 158: "earth sciences"},
                 sub_starts={"ANTH": 268, "SOC": 269}),
    "6768": dict(era="named", section=(141, 331), extra_depts=EARLY_DEPTS,
                 sub_starts={"ANTH": 321, "SOC": 322},
                 # p. 245's running head "Management Science" is Management Sciences, not Science
                 dept_starts={245: "management sciences"}, no_depts=["science"]),
    "6869": dict(era="named", section=(146, 366), extra_depts=EARLY_DEPTS,
                 sub_starts={"GRK": 186, "LAT": 187, "SPAN": 190, "ANTH": 358, "SOC": 360}),
    "6970": dict(era="named", section=(139, 347), extra_depts=EARLY_DEPTS,
                 dept_starts={257: "mathematics", 219: "geography and planning"},
                 subject_pages={"PLAN": 224},  # Planning's own heading, inside the department
                 sub_starts={"GRK": 176, "LAT": 177, "SPAN": 181, "ANTH": 337, "SOC": 338}),
    "7071": dict(era="named", section=(177, 441),
                 sub_starts={"ANTH": 415, "SOC": 419, "RUSS": 289, "UKRAN": 292}),
    "7172": dict(era="named", section=(181, 495), sub_starts={"ANTH": 467, "SOC": 472}),
    "7273": dict(era="named", section=(267, 559), sub_starts={"ANTH": 528, "SOC": 533}),
    "7374": dict(
        era="named", section=(271, 607), sub_starts={"ANTH": 572, "SOC": 578},
        # stray running-head matches put Economics in Chemical Engineering, Management
        # Sciences in Economics and Electrical Engineering in Mathematics; Geography's
        # first pages (386-399) have no text layer
        dept_starts={352: "economics", 358: "electrical engineering", 387: "geography",
                     442: "management sciences", 447: "man-environment studies", 454: "mathematics"},
        no_depts=["environmental studies"],  # "Environmental Studies 195*" inside Geography
    ),
    "7475": dict(era="named", section=(296, 679), sub_starts={"ANTH": 660}),
    "7576": dict(
        era="named", section=(224, 474),
        # subsection headings the OCR garbled ("RUSSiaIl") or that sit beside
        # other text; checked on the page images
        sub_starts={"FR": 265, "RUSS": 325, "UKRAN": 328},
        # Canadian Studies pp. 240-241 list other departments' courses
        no_course_pages=[240, 241],
    ),
    # Sociology follows Social Development Studies and Society, Technology and
    # Values, whose pages list cross-listed SOC courses; its heading is checked
    # on the page images in each year below.
    "8687": dict(era="coded", section=(289, 453),  # p. 451 has no text layer
                 subject_pages={"SOC": 441}),
    "8788": dict(era="coded", section=(299, 467),
                 # "Department of Fine Arts" heads the last column of p. 353
                 subject_pages={"SOC": 456, "FINE": 353}),
    "8889": dict(era="coded", section=(297, 466),  # whole PDF has no text layer
                 subject_pages={"SOC": 454}),
    "8990": dict(era="coded", section=(313, 490),
                 subject_pages={"SOC": 476, "STAT": 426}),
    "9091": dict(era="coded", section=(315, 466),
                 # a "SOCIOLOGY" sub-list of college courses closes Social Development
                 # Studies on p. 454; Sociology's own heading is p. 455 (calendar index)
                 subject_pages={"SOC": 455}),
    "9192": dict(era="coded", section=(322, 476)),
    "9293": dict(era="coded", section=(319, 466),  # p. 328 has no text layer
                 subject_pages={"SOC": 454}),
    "9394": dict(era="coded", section=(321, 468),
                 subject_pages={"SOC": 457}),
    "9495": dict(era="coded", section=(323, 471)),
    "7677": dict(
        era="named", section=(195, 414),
        # Latin and French headings sit beside other text; Mathematics has
        # one section per department (running heads), with coded headers
        sub_starts={"LAT": 230, "FR": 231},
        subject_pages={"MATH": 314, "AMATH": 318, "AM": 318, "CO": 320, "CS": 323,
                       "PMATH": 327, "STAT": 329},
        # Canadian Studies pp. 209-211 mostly list other departments' courses;
        # its own four are keyed by hand
        no_course_pages=[209, 210, 211],
        course_pages={"CDNST201": 210, "CDNST202": 210, "CDNST300": 210, "CDNST400": 210},
    ),
    "7778": dict(era="coded", section=(216, 449)),
    "7879": dict(era="coded", section=(217, 436)),
    "7980": dict(era="coded", section=(227, 450)),
    "8081": dict(era="coded", section=(241, 479)),
    "8182": dict(era="coded", section=(251, 490)),
    "8283": dict(era="coded", section=(257, 425)),
    "8384": dict(era="coded", section=(275, 436),
                 subject_pages={"SOC": 420}),  # "Department of Sociology" heads p. 420
    "8485": dict(era="coded", section=(277, 436)),
    "8586": dict(
        era="coded", section=(285, 448),
        # French headers read as "m 152", "FFI 151", "FP 254" on pp. 339-342
        ocr_codes={"m": ["FR", 339, 342], "FFI": ["FR", 339, 342], "FFl": ["FR", 339, 342],
                   "FP": ["FR", 339, 342]},
        # p. 448's two Women's Studies headers are unreadable OCR ("wsm")
        # CCIV starts at its own heading (p. 312); the department heading
        # "Classical Studies" on p. 311 is today's CLAS
        subject_pages={"WS": 447, "CLAS": 311},
        course_pages={"WS200": 448, "WS300": 448,
                      "CIVE291": 310},  # tesseract read CIV E 291 as 201
        drop=["CIVE201"],
    ),
}


# ==========================================================================
# Text extraction
# ==========================================================================

def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True).stdout


def page_count(pdf):
    out = run(["pdfinfo", pdf]).decode("latin-1")
    return int(re.search(r"^Pages:\s+(\d+)", out, re.M).group(1))


def load_pages(pdf, year, section, cache_dir, ocr=True):
    """Return {page: [lines]} for the whole PDF. Pages inside the section with
    almost no text are OCRed with tesseract when available."""
    n = page_count(pdf)
    text = run(["pdftotext", "-enc", "UTF-8", pdf, "-"]).decode("utf-8", "replace")
    chunks = text.split("\f")
    pages = {i + 1: (chunks[i] if i < len(chunks) else "") for i in range(n)}
    lo, hi = section
    empty = [p for p in range(lo, hi + 1) if len(pages[p].strip()) < 200]
    if empty and ocr:
        have = shutil.which("tesseract") and shutil.which("pdftoppm")
        ydir = os.path.join(cache_dir, year)
        os.makedirs(ydir, exist_ok=True)
        for p in empty:
            f = os.path.join(ydir, "ocr-%03d.txt" % p)
            if not os.path.exists(f):
                if not have:
                    continue
                print("  OCR page %d (no text layer)..." % p, file=sys.stderr)
                img = os.path.join(ydir, "tmp")
                run(["pdftoppm", "-r", "300", "-gray", "-png", "-singlefile",
                     "-f", str(p), "-l", str(p), pdf, img])
                txt = run(["tesseract", img + ".png", "stdout", "--psm", "3"])
                os.remove(img + ".png")
                with open(f, "wb") as fh:
                    fh.write(txt)
            with open(f, encoding="utf-8", errors="replace") as fh:
                pages[p] = fh.read()
    missing = [p for p in empty if len(pages[p].strip()) < 200]
    return {p: t.split("\n") for p, t in pages.items()}, missing


# ==========================================================================
# Helpers
# ==========================================================================

def letters(s):
    return re.sub(r"[^a-z]", "", s.lower())


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


DIGITS = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1", "!": "1", "i": "1"})


def fix_number(tok):
    """OCR-tolerant 3-digit course number. Returns 'NNN' or None."""
    t = tok.translate(DIGITS)
    return t if re.fullmatch(r"\d{3}", t) else None


def nonempty(lines):
    return [l for l in lines if l.strip()]


# ==========================================================================
# Coded era
# ==========================================================================

CONFUSE = [set("O0DQCG"), set("I1LlJ!|itfT"), set("S5s"), set("B8"), set("EF"),
           set("HNM"), set("UV"), set("CT"), set("GC6")]


def sub_cost(a, b):
    if a == b:
        return 0.0
    if a.upper() == b.upper():
        return 0.0
    for g in CONFUSE:
        if (a in g or a.upper() in g) and (b in g or b.upper() in g):
            return 0.4
    return 1.0


def ocr_distance(a, b):
    """Weighted edit distance between OCR text a and code b."""
    n, m = len(a), len(b)
    d = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        d[i][0] = float(i)
    for j in range(1, m + 1):
        d[0][j] = float(j)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1,
                          d[i - 1][j - 1] + sub_cost(a[i - 1], b[j - 1]))
    return d[n][m]


HEADER_RE = re.compile(
    r"^\s*(?P<code>[A-Za-z&][A-Za-z&0 ]{0,8}?)\s*"
    r"(?P<num>(?:[0-9]|(?<=\s)[Il|!])[0-9OoIl|!]{2})(?P<d4>[0-9]?)(?P<suf>[A-Za-z]{0,2})(?![A-Za-z0-9])"
    r"(?P<alts>(?:\s*/\s*[0-9OoIl|!]{2,3}[A-Za-z]{0,2}(?![A-Za-z0-9]))*)"
    r"(?P<rest>.*)$")
UNITS_RE = re.compile(r"(?<![\w.])(?:[0-2]\s?[.,]\s?\d{1,2}|05|0\.25)(?![\d])")
TERMS_RE = re.compile(r"(?<![A-Za-z])[FWS]\s?[,.]\s?[FWSs](?![A-Za-z])|^\s*[FWS](?:\s|$)")
HOURS_RE = re.compile(r"(?<![A-Za-z])(?:\d{1,2}|X|S)\s?(?:C|L|T|S|R|s|c|std|D|~)(?![a-z])")
# a line holding only terms, e.g. "w" or "F,W" under a header whose title went first
TERMS_LINE_RE = re.compile(r"^\s*[FWSfws](?:\s?[,.]\s?[FWSfws])*\s*(?:[X\d].*)?$")


def norm_code(s):
    return re.sub(r"[\s&]", "", s).upper().translate(str.maketrans("0158", "OISB"))


def resolve_code(raw, codes, ocr_codes, page, fuzzy=True):
    """Map the OCR'd code text to a known key, or None."""
    raw = raw.strip()
    if not raw:
        return None
    cand = [raw]
    parts = raw.split()
    if len(parts) > 1:  # "As GER 101": try dropping a leading word
        cand.append(" ".join(parts[1:]))
    for c in cand:
        for form in (c, norm_code(c)):
            v = ocr_codes.get(form)
            if isinstance(v, str):
                return v
            if v and v[1] <= page <= v[2]:
                return v[0]
        if norm_code(c) in codes:
            return norm_code(c)
    if not fuzzy:
        return None
    best, bestd = None, 9.0
    for c in cand:
        n = re.sub(r"[\s&]", "", c)
        if len(n) < 2 or not re.search(r"[A-Za-z]", n):
            continue
        for k in sorted(codes):
            if abs(len(k) - len(n)) > 1:
                continue
            dist = ocr_distance(n, k)
            lim = 0.4 if len(k) <= 2 else (0.8 if len(k) == 3 else 1.2)
            if dist <= lim and dist < bestd:
                best, bestd = k, dist
    return best


def looks_like_title(s):
    words = re.findall(r"[A-Za-z]{2,}", s)
    return bool(re.match(r"\s*[A-Z(]", s)) and sum(len(w) for w in words) >= 5


def has_spec(s):
    return bool(UNITS_RE.search(s) or TERMS_RE.search(s) or HOURS_RE.search(s))


def coded_candidates(pages, lo, hi, codes, ocr_codes, fuzzy=True):
    """Header candidates: dict(page, line, key, nums, kind, text).
    kind: full = header with terms/hours/units; list = code + title only."""
    out = []
    for p in range(lo, hi + 1):
        lines = pages[p]
        for i, line in enumerate(lines):
            m = HEADER_RE.match(line)
            if not m:
                continue
            key = resolve_code(m.group("code"), codes, ocr_codes, p, fuzzy)
            if not key:
                continue
            num = fix_number(m.group("num"))
            if not num:
                continue
            rest = m.group("rest")
            rest = re.sub(r"^\s*-\s*[0-9A-Za-z]{1,4}(?![\w.])", "", rest)  # "ACC 415-419", "CHEM 465A-Z"
            if re.match(r"\s*[,;:)\-]|\s*\.\s*$|\s*(and|or|to|is|in)\b", rest):
                continue  # a prerequisite list that wraps onto a new line
            suf = m.group("suf")
            if len(suf) == 2 and not suf.isupper():
                continue  # "MATH 13!la" is 130a misread
            suf = suf.upper()
            if m.group("d4"):
                # "3908" is 390B misread; resolved later if 390A exists
                if m.group("d4") not in "68" or suf:
                    continue
                suf = "B?"
            nums = [num + suf]
            for a in re.findall(r"/\s*([0-9OoIl|!]{2,3})([A-Za-z]{0,2})", m.group("alts")):
                an = fix_number(a[0]) if len(a[0]) == 3 else None
                if an:
                    nums.append(an + a[1].upper())
            head = rest if not looks_like_title(rest) else rest[:12]
            spec = has_spec(head)
            if not spec and not rest.strip():
                for nxt in nonempty(lines[i + 1:i + 4])[:2]:
                    if HEADER_RE.match(nxt) and resolve_code(HEADER_RE.match(nxt).group("code"), codes, ocr_codes, p):
                        break
                    if (has_spec(nxt) or TERMS_LINE_RE.match(nxt)) and not looks_like_title(nxt):
                        spec = True
                        break
                    if looks_like_title(nxt):
                        break
            if spec:
                kind = "full"
            elif looks_like_title(rest):
                kind = "list"
            else:
                kind = "bare"
                # a bare "PHIL 210" with the title on the next line is a header
                # whose terms/units the OCR lost, unless it ends a sentence
                nxt = nonempty(lines[i + 1:i + 3])[:1]
                prev = nonempty(lines[max(0, i - 2):i])[-1:]
                if (not rest.strip() and nxt and looks_like_title(nxt[0]) and not HEADER_RE.match(nxt[0])
                        and not (prev and re.search(r"([,;:]|\b(or|and|of|in|to|Prereq\w*|Antireq\w*|Coreq\w*))\s*$", prev[0]))):
                    kind = "titled"
            out.append(dict(page=p, line=i, key=key, nums=nums, kind=kind, text=line.strip()))
    return out


def main_run(page_counts):
    """page_counts: {page: n}. (start, end) of the run around the busiest page."""
    if not page_counts:
        return None
    peak = max(sorted(page_counts), key=lambda p: page_counts[p])
    s = peak
    while page_counts.get(s - 1, 0) >= 1:
        s -= 1
    e = peak
    while page_counts.get(e + 1, 0) >= 1:
        e += 1
    return s, e


HEAD_NOISE = re.compile(r"(?i)course\s*desc\w*|undergraduate|dep\w{2,6}ent\s+of|school\s+of|faculty\s+of|group\b")


def is_name(t):
    """Best subject-name match for heading text (letters only), or None."""
    if len(t) < 4:
        return None
    if t in ALL_NAMES:
        return t
    near = [g for g in ALL_NAMES if len(g) >= 6 and abs(len(t) - len(g)) <= 3]
    if not near:
        return None
    best = max(near, key=lambda g: ratio(t, g))
    return best if ratio(t, best) >= 0.8 else None


def heading_hit(lines, names):
    """Is one of names a heading on this page? Headings are short lines (or two
    or three short lines, e.g. "Department of / Chemical / Engineering").
    Fuzzy (OCR) matches count only if no other subject name fits better
    ("Chemical Engineering" is not "Mechanical Engineering"), and a name in an
    umbrella department's list of members ("Fine Arts / see page 16:5") is no
    heading."""
    targets = {letters(n) for n in names if len(letters(n)) >= 4}
    body = [l.strip() for l in lines if l.strip()]
    for j in range(len(body)):
        for span in (1, 2, 3):
            seg = body[j:j + span]
            if len(seg) < span or any(len(x) > 40 for x in seg):
                continue
            if seg[-1][-1] in ".,;" or seg[0][0].islower():
                continue
            hit = is_name(letters(HEAD_NOISE.sub("", " ".join(seg))))
            if hit not in targets:
                continue
            if j + span < len(body) and re.match(r"(?i)\S{0,3}\s*page\s", body[j + span]):
                continue  # umbrella list: "Drama and Theatre Arts / see page 16:44"
            return True
    return False


# OCR misreads of codes seen in several years ("CBO331" is C&O 331)
OCR_CODES = {"CBO": "CO", "C8O": "CO", "C&0": "CO", "CB0": "CO", "CAO": "CO", "EBCE": "ECE", "E8CE": "ECE",
             "SOT": "SOC", "ETON": "ECON", "EIE": "ELE", "RET": "REC", "HELTH": "HLTH", "LTAL": "ITAL",
             "RNE": "FINE", "FLNE": "FINE", "CDST": "CDNST", "BIOI": "BIOL", "BLOL": "BIOL", "HLST": "HIST",
             "HIAT": "HIST", "PHLL": "PHIL", "PSCL": "PSCI", "MUSLC": "MUSIC", "ENGI": "ENGL"}

ALL_NAMES = sorted({letters(n) for n in list(SUBJECT_NAMES.values()) + sum(HEADINGS.values(), [])})


def index_coded(pages, cfg, log):
    lo, hi = cfg["section"]
    ocr_codes = dict(OCR_CODES, **cfg.get("ocr_codes", {}))
    allcodes = set(SUBJECT_NAMES) | set(cfg.get("codes", []))
    # pass 1: exact codes only, to learn which codes this calendar uses
    first = coded_candidates(pages, lo, hi, allcodes, ocr_codes, fuzzy=False)
    used = Counter(c["key"] for c in first if c["kind"] in ("full", "titled"))
    codes = {k for k, n in used.items() if n >= 2} | set(cfg.get("codes", []))
    cands = coded_candidates(pages, lo, hi, codes, ocr_codes)
    log["codes"] = sorted(codes)

    per = defaultdict(Counter)
    for c in cands:
        if c["kind"] == "full":
            per[c["key"]][c["page"]] += 1
    for c in cands:  # subjects seen only in course lists or title-only headers
        if c["key"] not in per and c["kind"] in ("list", "titled"):
            per[c["key"]][c["page"]] += 1
    full_on = defaultdict(Counter)  # page -> {key: n}
    for c in cands:
        if c["kind"] == "full":
            full_on[c["page"]][c["key"]] += 1

    subjects, runs = {}, {}
    for key, cnt in per.items():
        r = main_run(cnt)
        # drop leading pages where another subject's headers outnumber this
        # one's (cross-listed courses printed in the previous section)
        s0, e0 = r
        while s0 < e0 and max((n for k2, n in full_on[s0].items() if k2 != key), default=0) > cnt[s0]:
            s0 += 1
        r = (s0, e0)
        runs[key] = r
        start = r[0]
        names = [SUBJECT_NAMES.get(key, key)] + HEADINGS.get(key, [])
        # pull back to the subject's own heading: a faculty list or intro
        # page, or the foot of the previous subject's last page
        # (each page walked over must carry the heading, e.g. as running head)
        for q in range(r[0] - 1, max(lo, r[0] - 3) - 1, -1):
            if not heading_hit(pages[q], names):
                break
            start = q
            if any(k != key for k in full_on[q]):
                break  # the previous subject ends on this page
        subjects[key] = start
    log["runs"] = runs

    courses, best = {}, {}
    rank = {"full": 0, "list": 1, "titled": 2}
    for c in cands:
        if c["kind"] == "bare":
            continue
        r = runs.get(c["key"])
        inrun = r is not None and r[0] <= c["page"] <= r[1]
        for num in c["nums"]:
            ck = c["key"] + num
            # a course's own section beats a mention elsewhere, then header kind
            score = (0 if inrun else 1, rank[c["kind"]], c["page"])
            if ck not in best or score < best[ck]:
                best[ck] = score
                courses[ck] = c["page"]
    for ck in [k for k in courses if k.endswith("B?")]:  # resolve "3908" -> 390B
        page = courses.pop(ck)
        if ck[:-2] + "A" in courses and ck[:-1] not in courses:
            courses[ck[:-1]] = page
    log["cands"] = cands
    return subjects, courses


# ==========================================================================
# Named era
# ==========================================================================

def dept_label(line):
    """Best department for a heading-like line, or None."""
    t = letters(re.sub(r"(?i)course\s*desc\w*|undergraduate|^\s*\d+\s*|department\s+of|school\s+of", "", line))
    if len(t) < 4:
        return None, 0
    best, bs = None, 0.0
    for d in DEPARTMENTS:
        for name in d["match"]:
            g = letters(name)
            s = 1.0 if t == g else ratio(t, g)
            if len(g) <= 6 and t != g:
                s = 0  # short names must match exactly
            if s > bs:
                best, bs = d, s
    return (best, bs) if bs >= 0.8 else (None, bs)


def page_dept(lines, top=6, with_score=False):
    """Department named in the running head (first lines), or None."""
    body = nonempty(lines)[:top]
    found = []
    for j in range(len(body)):
        for span in (1, 2, 3):
            seg = " ".join(body[j:j + span])
            d, s = dept_label(seg)
            if d:
                found.append((s, -span, d))
    if not found:
        return None
    best = max(found, key=lambda x: (x[0], x[1]))
    return (best[2], best[0]) if with_score else best[2]


HEADING_RE = re.compile(r"^\s*(?:dep\w{2,6}ent|school|schod|schoot)\s+of\s+(?:the\s+)?(.+)$", re.I)


def heading_dept(lines):
    """Department named by a "Department of X" / "School of X" heading
    anywhere on the page (the heading may wrap over two or three lines)."""
    body = [l.strip() for l in lines if l.strip()]
    for j in range(len(body)):
        m = HEADING_RE.match(" ".join(body[j:j + 2])) if re.match(r"(?i)\s*(dep|sch)", body[j]) else None
        if not m:
            continue
        rest = m.group(1) + " " + " ".join(body[j + 2:j + 3])
        if "(" in m.group(1) or ")" in m.group(1):
            continue  # "London School of Economics)" in a staff list
        words = rest.split()
        for k in range(min(len(words), 7), 0, -1):
            d, s = dept_label(" ".join(words[:k]))
            if d:
                return d
    return None


NAMED_RE = re.compile(
    r"^\s*(?:(?P<pfx>[A-Z][A-Za-z&]{1,5}(?:\s[A-Z][a-z]{1,2})?)\s+)?"
    r"(?P<num>[0-9][0-9OoIl]{2}|[lI][0-9OoIl]{2})(?P<suf>[A-Za-z]{0,2})\s*(?P<star>[*’'”\"‘+]?)\.?"
    r"(?P<alts>(?:\s*/\s*[0-9OoIl]{3}[A-Za-z]{0,2}\s*[*’'”\"]?)*)"
    r"\s*(?P<rest>.*)$")


def named_candidates(lines, page):
    out = []
    body = [(i, l) for i, l in enumerate(lines) if l.strip()]
    for j, (i, line) in enumerate(body):
        m = NAMED_RE.match(line)
        if not m or (re.fullmatch(r"[Il]{3}", m.group("num")) and not m.group("star")):
            continue  # "IIIA (EE 42" is a Roman numeral; "lllL*" and "lOl" are courses
        num = fix_number(m.group("num"))
        if not num:
            continue
        suf = m.group("suf")
        rest = m.group("rest")
        pfx = m.group("pfx")
        if suf and suf.islower() and len(suf) == 2:
            continue  # "12th century"
        if not rest.strip():
            # a header whose title went to the next line: needs a * or suffix
            if not (m.group("star") or suf):
                continue
            nxt = body[j + 1][1] if j + 1 < len(body) else ""
            if not re.match(r"\s*[A-Z]", nxt):
                continue
        elif not re.match(r"[A-Z(]", rest) or re.match(r"(and|or|to|is|in)\b", rest):
            continue
        elif re.match(r"(Note|Prerequisite|Hours|Year|Term)\b", rest):
            continue
        nums = [num + suf.upper()]
        for a in re.findall(r"/\s*([0-9OoIl]{3})([A-Za-z]{0,2})", m.group("alts")):
            an = fix_number(a[0])
            if an:
                nums.append(an + a[1].upper())
        out.append(dict(page=page, line=i, j=j, nums=nums, pfx=pfx, text=line.strip()))
    # course tables: three or more candidates within four lines -> list entries
    js = [c["j"] for c in out]
    for c in out:
        near = sum(1 for x in js if 0 < abs(x - c["j"]) <= 3)
        c["kind"] = "list" if near >= 2 else "full"
    return out


def sub_headings(lines, page, subs):
    """[(line_index, key)] for subsection headings ("Greek", "Health Studies")
    on a page. Headings are short lines without digits. One-word names also
    need context, because narrow columns leave words like "French" alone on a
    line: the next line must be a course header, a page number, or a line
    that starts a section ("Note", "Professor", ...)."""
    out = []
    idx = [i for i, l in enumerate(lines) if re.search(r"[A-Za-z0-9]", l)]
    cand_lines = {c["line"] for c in named_candidates(lines, page)}
    for n, i in enumerate(idx):
        raw = lines[i].strip()
        if len(raw) > 32 or re.search(r"\d", raw) or not raw[0].isupper():
            continue
        t = letters(raw)
        for key, names in subs:
            hit = None
            for name in names:
                g = letters(name)
                if t == g or (len(g) >= 6 and abs(len(t) - len(g)) <= 2 and ratio(t, g) >= 0.75):
                    hit = len(name.split()) > 1 and t == g and "strong" or "weak"
                    break
            if not hit:
                continue
            if hit == "weak":
                j = idx[n + 1] if n + 1 < len(idx) else None
                nxt = lines[j].strip() if j is not None else ""
                if not (j in cand_lines or re.fullmatch(r"\d{3}", nxt) or
                        re.match(r"(Note|Professor|Associate|Assistant|Undergraduate|Course|"
                                 r"The following|General|Lecturer)", nxt)):
                    continue
            out.append((i, key))
            break
    return out


def find_departments(pages, lo, hi, forced, dropped=()):
    """[(start_page, dept)] sorted by page.

    Each page gets a label from a "Department of" heading or its running head.
    A label is confident if it is a heading, an exact running head, or has a
    same-label neighbour within 3 pages. A department's span joins its labelled pages as long as no
    confident label of another department falls between them; the span with
    the most labels wins, and its first page (or a heading up to 2 pages
    earlier) is the start. Stray labels ("for Electrical Engineers") lose."""
    label, strong, exact = {}, set(), set()
    for p in range(lo, hi + 1):
        d = heading_dept(pages[p])
        if d:
            label[p] = d
            strong.add(p)
        else:
            d = page_dept(pages[p], with_score=True)
            if d:
                label[p] = d[0]
                if d[1] == 1.0:
                    exact.add(p)
    confident = strong | exact
    for p, d in label.items():
        if any(label.get(q) is d for q in range(p - 3, p + 4) if q != p):
            confident.add(p)
    byid = {}
    for p, d in label.items():
        byid.setdefault(id(d), (d, []))[1].append(p)
    starts = []
    for d, ps in byid.values():
        ps.sort()
        spans, cur = [], [ps[0]]
        for p in ps[1:]:
            between = [q for q in confident if cur[-1] < q < p and label[q] is not d]
            if between:
                spans.append(cur)
                cur = [p]
            else:
                cur.append(p)
        spans.append(cur)
        best = max(spans, key=lambda s: (len(s), sum(1 for q in s if q in confident)))
        if not any(q in confident for q in best):
            continue
        s = best[0]
        for h in ps:
            if h in strong and best[0] - 2 <= h < s:
                s = h
        starts.append([s, d, len(best)])
    starts = [x for x in starts if not any(n in x[1]["match"] for n in dropped)]
    for p, name in forced.items():
        d = next(x for x in DEPARTMENTS if name in x["match"])
        starts = [x for x in starts if x[1] is not d] + [[int(p), d, 999]]
    starts.sort(key=lambda x: (x[0], -x[2]))
    out = []
    for s in starts:
        if out and out[-1][0] == s[0]:
            continue  # two departments on one start page: keep the better one
        out.append(s)
    return [(s[0], s[1]) for s in out]


def index_named(pages, cfg, log):
    extra = cfg.get("extra_depts", [])
    DEPARTMENTS.extend(extra)
    try:
        return _index_named(pages, cfg, log)
    finally:
        del DEPARTMENTS[len(DEPARTMENTS) - len(extra):]


def _index_named(pages, cfg, log):
    lo, hi = cfg["section"]
    depts = find_departments(pages, lo, hi, cfg.get("dept_starts", {}), cfg.get("no_depts", ()))
    log["dept_starts"] = [(p, d["match"][0]) for p, d in depts]
    forced_subs = cfg.get("sub_starts", {})
    subjects, courses, best = {}, {}, {}
    log["subs"] = {}
    for idx, (p0, d) in enumerate(depts):
        p1 = depts[idx + 1][0] - 1 if idx + 1 < len(depts) else hi
        for k in d["keys"]:
            subjects.setdefault(k, p0)
        subs = d.get("subs")
        owner = {}  # page -> subject whose courses fill the whole page
        if subs:
            # subsection starts; the first subsection starts with the department
            starts = {subs[0][0]: p0}
            for p in range(p0, p1 + 1):
                for _, k in sub_headings(pages[p], p, subs):
                    starts.setdefault(k, p)
            for k, _ in subs:
                if k in forced_subs:
                    starts[k] = forced_subs[k]
            order = sorted((p, k) for k, p in starts.items())
            log["subs"][d["match"][0]] = order
            for n, (p, k) in enumerate(order):
                subjects[k] = p  # a subsection's own start beats the department's
                end_p = order[n + 1][0] if n + 1 < len(order) else p1
                for q in range(p, end_p + 1):
                    # a page where one subsection ends and the next begins is
                    # shared: its courses get no keys (they fall back to the
                    # subject page) ...
                    owner[q] = None if q in owner else k
            for p, k in order:
                # ... unless the new subsection's heading is the only one on
                # the page and comes before every course in reading order
                if p == p0 or [x for x in order if x[0] == p] != [(p, k)]:
                    continue
                found = sub_headings(pages[p], p, subs)
                hs = [i for i, kk in found if kk == k]
                cl = [c["line"] for c in named_candidates(pages[p], p)]
                if hs and len(hs) == len(found) and (not cl or min(hs) < min(cl)):
                    owner[p] = k
        else:
            for q in range(p0, p1 + 1):
                owner[q] = d["keys"][0] if d["keys"] else None
        skip = set(cfg.get("no_course_pages", []))
        for p in range(p0, p1 + 1):
            if p in skip:
                continue
            for c in named_candidates(pages[p], p):
                if c["kind"] == "list" and len(c["text"]) < 38:
                    # short lines in a run of course numbers are lists, often of
                    # other departments' courses; long ones carry a description
                    # beside the title (the 1969-72 layout)
                    continue
                subj = owner.get(p)
                if c["pfx"]:
                    subj = NAMED_PREFIXES.get(letters(c["pfx"]))  # "ISS 320R*", "Soc Wk 368R*"
                elif d.get("prefixed_only"):
                    continue
                if not subj:
                    continue
                for num in c["nums"]:
                    if d.get("only_courses") and not re.fullmatch(d["only_courses"], num):
                        continue
                    ck = subj + num
                    score = (0 if c["kind"] == "full" else 1, c["page"])
                    if ck not in best or score < best[ck]:
                        best[ck] = score
                        courses[ck] = c["page"]
    return subjects, courses


# ==========================================================================
# Output, checks, contact sheets
# ==========================================================================

def year_key(pdf, override=None):
    if override:
        return override
    m = re.search(r"(\d{2})(\d{2})\s*[-_]\s*(\d{2})", os.path.basename(pdf))
    if not m:
        sys.exit("can't tell the year from %r; pass --year YYyy" % pdf)
    return m.group(2) + m.group(3)


def add_aliases(index):
    out = dict(index)
    for old, (new, with_courses) in ALIASES.items():
        if old in index and new not in index:
            out[new] = index[old]
        if with_courses:
            for k, v in index.items():
                if re.fullmatch(old + r"\d{3}[A-Z]{0,2}", k):
                    out.setdefault(new + k[len(old):], v)
    return out


def write_json(path, index):
    keys = sorted(index)
    body = ",\n".join('"%s": %d' % (k, index[k]) for k in keys)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("{\n" + body + "\n}")


def order_check(subjects):
    """Subjects whose start page breaks alphabetical order by name."""
    items = sorted((p, SORT_NAMES.get(k, SUBJECT_NAMES.get(k, k)), k) for k, p in subjects.items())
    bad = []
    for a, b in zip(items, items[1:]):
        if a[1].lower() > b[1].lower() and a[0] != b[0]:
            bad.append("%s(%s, p%d) before %s(%s, p%d)" % (a[2], a[1], a[0], b[2], b[1], b[0]))
    return bad


def contact_sheet(pdf, pages, out, labels=None, top=0.3, cols=5, dpi=50):
    """Tops of the given pages side by side, labelled, for checking where
    sections start. Needs Pillow."""
    from PIL import Image, ImageDraw
    tmp = tempfile.mkdtemp()
    tiles = []
    for i, p in enumerate(pages):
        run(["pdftoppm", "-r", str(dpi), "-gray", "-png", "-singlefile", "-f", str(p), "-l", str(p),
             pdf, os.path.join(tmp, "p")])
        im = Image.open(os.path.join(tmp, "p.png"))
        im = im.crop((0, 0, im.width, int(im.height * top)))
        tile = Image.new("L", (im.width, im.height + 14), 255)
        tile.paste(im, (0, 14))
        ImageDraw.Draw(tile).text((3, 1), "p%d %s" % (p, labels[i] if labels else ""), fill=0)
        tiles.append(tile)
    shutil.rmtree(tmp)
    w, h = tiles[0].size
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("L", (w * cols, h * rows), 160)
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * w, (i // cols) * h))
    sheet.save(out)
    return out


def locate_header(pdf, page, key, png, scale):
    """(x, y) in image pixels of the line that starts course key, or None.
    Uses the PDF text layer, or tesseract word boxes on image-only pages."""
    import html
    num = re.search(r"\d{3}", key).group()
    lines = []  # (words, x, y), y in image pixels
    xml = run(["pdftotext", "-bbox-layout", "-f", str(page), "-l", str(page), pdf, "-"]).decode("utf-8", "replace")
    pw = float(re.search(r'<page width="([\d.]+)"', xml).group(1))
    for ln in re.findall(r"<line[^>]*>(.*?)</line>", xml, re.S):
        ws = re.findall(r'xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>(.*?)</word>', ln)
        if ws:
            s = scale / pw
            lines.append(([html.unescape(w[2]) for w in ws], float(ws[0][0]) * s, float(ws[0][1]) * s))
    if not lines and shutil.which("tesseract"):
        hi_res = png[:-4] + "-ocr"
        run(["pdftoppm", "-r", "250", "-gray", "-png", "-singlefile", "-f", str(page), "-l", str(page),
             pdf, hi_res])
        from PIL import Image
        k = scale / Image.open(hi_res + ".png").width
        tsv = run(["tesseract", hi_res + ".png", "stdout", "--psm", "3", "tsv"]).decode("utf-8", "replace")
        rows = defaultdict(list)
        for r in tsv.splitlines()[1:]:
            f = r.split("\t")
            if len(f) == 12 and f[11].strip():
                rows[(f[2], f[3], f[4])].append((int(f[6]) * k, int(f[7]) * k, f[11]))
        for ws in rows.values():
            lines.append(([w[2] for w in ws], ws[0][0], ws[0][1]))
    found = None
    for words, x, y in lines:
        head = fix_digits(" ".join(words[:4]))
        m = HEADER_RE.match(head) or NAMED_RE.match(head)
        if m and fix_number(m.group("num")) == num:
            return x, y
        if found is None and num in head:
            found = (x, y)
    return found


def crop_sheet(pdf, items, out, dpi=110):
    """Crop each course header out of its page image, to check by eye that the
    key matches what is printed. items: [(key, page)]. Needs Pillow."""
    from PIL import Image, ImageDraw
    tmp = tempfile.mkdtemp()
    crops = []
    for key, page in items:
        png = os.path.join(tmp, "p.png")
        run(["pdftoppm", "-r", str(dpi), "-gray", "-png", "-singlefile", "-f", str(page), "-l", str(page),
             pdf, os.path.join(tmp, "p")])
        im = Image.open(png)
        pos = locate_header(pdf, page, key, png, im.width)
        s = dpi / 72.0
        if pos:
            x0, y0 = max(0, pos[0] - 4 * s), max(0, pos[1] - 10 * s)
            im = im.crop((int(x0), int(y0), int(x0 + 170 * s), int(y0 + 34 * s)))
        else:
            im = im.crop((0, 0, int(170 * s), int(34 * s)))
            key += " ?"
        tile = Image.new("L", (im.width + 120, im.height), 255)
        tile.paste(im, (120, 0))
        ImageDraw.Draw(tile).text((4, 4), "%s\np%d" % (key, page), fill=0)
        crops.append(tile)
    shutil.rmtree(tmp)
    cols = 2
    w = max(c.width for c in crops)
    h = max(c.height for c in crops)
    sheet = Image.new("L", (w * cols, h * ((len(crops) + cols - 1) // cols)), 255)
    for i, c in enumerate(crops):
        sheet.paste(c, ((i % cols) * w, (i // cols) * h))
    sheet.save(out)
    return out


def fix_digits(s):
    return s.translate(DIGITS)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--year", help="YYyy, e.g. 8586 (default: from the file name)")
    ap.add_argument("--out", default=os.path.join("data", "archive"))
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "uwloo_archive_cache"))
    ap.add_argument("--report", action="store_true", help="print subjects with page runs")
    ap.add_argument("--sheet", help="A-B: contact sheet of those page tops, then exit; "
                    "'starts': tops of every subject's start page after indexing")
    ap.add_argument("--no-ocr", action="store_true")
    ap.add_argument("--seed", default="0", help="vary the --check sample")
    ap.add_argument("--check", help="N (random sample) or KEY,KEY: crop those course headers into check-YYyy.jpg")
    a = ap.parse_args()

    year = year_key(a.pdf, a.year)
    if a.sheet and a.sheet != "starts":
        f, l = map(int, a.sheet.split("-"))
        print(contact_sheet(a.pdf, list(range(f, l + 1)), "sheet-%s-%d-%d.jpg" % (year, f, l)))
        return
    if year not in YEARS:
        sys.exit("no YEARS entry for %s: add its era and section page range first" % year)
    cfg = YEARS[year]
    pages, missing = load_pages(a.pdf, year, cfg["section"], a.cache, ocr=not a.no_ocr)
    if missing:
        print("WARNING: no text for pages %s (install tesseract)" % missing, file=sys.stderr)
    log = {}
    if cfg["era"] == "coded":
        subjects, courses = index_coded(pages, cfg, log)
    else:
        subjects, courses = index_named(pages, cfg, log)
    subjects.update(cfg.get("subject_pages", {}))
    courses.update(cfg.get("course_pages", {}))
    index = {"_courses": cfg["section"][0]}
    index.update(subjects)
    index.update(courses)
    for k in cfg.get("drop", []):
        index.pop(k, None)
    index = add_aliases(index)
    index = {k: v for k, v in index.items() if KEY_RE.match(k)}
    bad = [k for k in index if not KEY_RE.match(k)]
    assert not bad, bad

    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, year + ".json")
    write_json(path, index)
    nsub = sum(1 for k in index if k != "_courses" and not re.search(r"\d", k))
    ncrs = sum(1 for k in index if re.search(r"\d", k))
    print("%s: %d subjects, %d courses -> %s" % (year, nsub, ncrs, path))
    for msg in order_check({k: v for k, v in subjects.items() if k not in
                            {new for new, _ in ALIASES.values()}}):
        print("  order? " + msg)
    if a.sheet == "starts":
        subj = sorted((v, k) for k, v in subjects.items())
        print(contact_sheet(a.pdf, [p for p, _ in subj], "starts-%s.jpg" % year, [k for _, k in subj]))
    if a.check:
        import random
        ck = [k for k in index if re.search(r"\d", k) and not any(k.startswith(n) for n, _ in ALIASES.values())]
        if a.check.isdigit():
            random.seed(int(year) + int(a.seed))
            picks = random.sample(sorted(ck), min(int(a.check), len(ck)))
        else:
            picks = a.check.split(",")
        print(crop_sheet(a.pdf, [(k, index[k]) for k in picks], "check-%s.jpg" % year))
    if a.report:
        runs = log.get("runs", {})
        for k, p in sorted(subjects.items(), key=lambda x: (x[1], x[0])):
            n = sum(1 for c in index if re.fullmatch(k + r"\d{3}[A-Z]{0,2}", c))
            print("  %-7s p%-4d run %-10s %3d courses  %s" % (k, p, runs.get(k, ""), n, SUBJECT_NAMES.get(k, "")))
        if "dept_starts" in log:
            for p, n in log["dept_starts"]:
                print("  dept p%-4d %s" % (p, n))


if __name__ == "__main__":
    main()
