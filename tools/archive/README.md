# Calendar page indexes

`index_pdf.py` builds `data/archive/{YYyy}.json` for a scanned undergraduate calendar
(ucalendar.uwaterloo.ca/6394/YYYY-YY.pdf, downloaded by hand). Each file maps keys to
physical PDF page numbers (1-based index in the file):

    { "_courses": 285, "ACC": 285, "ACC101": 286, ... }

The router does `pages["CS241"] || pages["CS"] || pages["_courses"]` and opens `#page=N`.

## Running it

Needs Python 3 and poppler (`pdftotext`, `pdftoppm`). Tesseract is used only for pages with
no text layer (1985-86 has 18), and Pillow only for the check images.

    python tools/archive/index_pdf.py path/to/1985-86.pdf             # writes data/archive/8586.json
    python tools/archive/index_pdf.py path/to/1985-86.pdf --report    # subjects, page runs, counts
    python tools/archive/index_pdf.py path/to/1985-86.pdf --sheet starts  # tops of every subject's start page
    python tools/archive/index_pdf.py path/to/1985-86.pdf --check 16  # crops of 16 random course headers
    python tools/archive/index_pdf.py path/to/1985-86.pdf --sheet 300-330 # tops of a page range

A year must have an entry in `YEARS` (era, course-descriptions page range, manual fixes)
before it can be indexed.

## How it works

- **coded era** (1977-78 to 1994-95): every description starts with a header such as
  `CS 241 F,W,S 3C 0.5`. A header needs terms, hours or units after the number (on the same
  line or the next two). Codes are matched OCR-tolerantly against the codes the calendar
  uses. A subject starts at its main run of headers, moved back to its own heading
  ("Department of ...", running head) when that is on the page or two before.
- **named era** (1963-64 to 1976-77): no letter codes. Departments come from running heads and
  "Department of" headings and map to today's codes. Shared departments are split at their
  subsection headings (Greek, Latin, Health Studies...); a page holding two subsections gets no
  course keys, so those courses fall back to the subject page.
- Renamed codes get today's code too: AM→AMATH (with course keys), ELE→ECE (with course keys),
  ACC→AFM, ISS→SDS, WS→GSJ, CCIV→CLAS, MENV→ERS.

## Indexed so far

| Year | Subjects | Courses | _courses | Notes |
|---|---|---|---|---|
| 1963-64 | 31 | 368 | 100 | Regenerated with the script from the original hand-read department starts; keeps all 349 earlier course keys and adds 19 lettered courses (PHIL 200a, RS 200G) |
| 1964-65 | 28 | 506 | 100 | Named departments; engineering undergraduate courses use 2-digit numbers (no course keys) |
| 1965-66 | 31 | 519 | 116 | Named departments |
| 1966-67 | 33 | 580 | 121 | Named departments; Anthropology p. 268, Sociology p. 269 |
| 1967-68 | 35 | 729 | 141 | Named departments; Anthropology p. 321, Sociology p. 322 |
| 1968-69 | 40 | 1,020 | 146 | Named departments; Classics and Romance Languages split into Greek, Latin, French, Italian, Spanish |
| 1969-70 | 44 | 1,155 | 139 | Named departments; descriptions printed beside titles |
| 1970-71 | 44 | 1,462 | 177 | Named departments; Anthropology (p. 415) before Sociology (p. 419); Mathematics is one section |
| 1971-72 | 47 | 1,549 | 181 | Named departments; Anthropology (p. 467) before Sociology (p. 472) |
| 1972-73 | 51 | 1,333 | 267 | Named departments; Anthropology (p. 528) before Sociology (p. 533) |
| 1973-74 | 52 | 1,385 | 271 | Named departments; pp. 358 and 386-399 OCRed; several department starts set by hand |
| 1974-75 | 55 | 1,749 | 296 | Named departments; Environmental Studies departments grouped after English |
| 1975-76 | 60 | 1,861 | 224 | No letter codes; CS, CO, AMATH, PMATH, STAT, ACTSC point to Mathematics (p. 358); ME and MSCI use 2-digit numbers; Greek, Latin, Italian, Ukrainian have subject keys only |
| 1976-77 | 57 | 2,056 | 195 | No letter codes except in Mathematics (AM, C&O, CS, PMath, Stat), whose departments have their own start pages; Canadian Studies courses keyed by hand |
| 1977-78 | 61 | 2,111 | 216 | First year with codes on every header (mixed case: "Hist 295", "Env St 200") |
| 1978-79 | 61 | 2,109 | 217 |  |
| 1979-80 | 62 | 2,406 | 227 |  |
| 1980-81 | 61 | 2,466 | 241 |  |
| 1981-82 | 62 | 2,306 | 251 |  |
| 1982-83 | 64 | 2,451 | 257 | Upper-case codes from here on ("ACC 371") |
| 1983-84 | 67 | 2,333 | 275 |  |
| 1984-85 | 66 | 2,381 | 277 |  |
| 1985-86 | 70 | 2,248 | 285 | pp. 307-324 OCRed; subject pages match the calendar index |
| 1986-87 | 67 | 1,878 | 289 | Poor OCR, so fewer course keys than neighbouring years |
| 1987-88 | 66 | 2,177 | 299 |  |
| 1988-89 | 70 | 2,774 | 297 | PDF has no text layer; all 170 pages OCRed |
| 1989-90 | 72 | 2,555 | 313 |  |
| 1990-91 | 70 | 2,284 | 315 | Subject pages checked against the calendar index |
| 1991-92 | 73 | 2,452 | 322 | Subject pages checked against the calendar index |
| 1992-93 | 73 | 2,407 | 319 | p. 328 OCRed |
| 1993-94 | 73 | 2,359 | 321 | Subject pages checked against the calendar index |
| 1994-95 | 75 | 2,409 | 323 | Regenerated with the script; keeps 1,738 of the 1,746 earlier course keys |

Subject counts include alias keys. Course keys include courses that appear only in
"courses not offered this year" lists; their page is that list. Sociology's start page is
set by hand in several 1983-1994 years: the Social Development Studies pages before it
list cross-listed SOC courses.
