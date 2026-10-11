# Course resources

Course pages list resources: PDFs uwloo hosts (only with permission) and links to material that lives
elsewhere. A resource is one thing as its author made it: a single PDF, a **set** (chapters 1 to 10,
lecture slides, assignments with solutions), links, or a mix, like a professor's chapter PDFs plus their
course site and lecture recordings. The course page shows one card per resource, listing its parts.

Each hosted PDF gets a page: the resource's notes on top, the list of parts (for a set), then the PDF,
drawn by PDF.js so it shows on every device instead of downloading. The first PDF lives at
`uwloo.ca/cs341/1249-notes/`, the others at `uwloo.ca/cs341/1249-notes/2/`, `/3/`…, with Previous and
Next between them. Those numbers never change, so links stay good when a chapter is added later.

```
data/resources/{SUBJ}.json         the catalogue (one list per subject; schema below)
data/resources/text/{file id}.txt  each PDF's text, for the "Text of this PDF" section and search engines
"files" release on GitHub          the PDFs themselves, named {file id}.pdf (never in git history)
tools/resources/intake.py          turns a zip of PDFs and links into catalogue entries
```

The build copies each catalogued PDF from the release into the site at `/files/{id}.pdf`. An entry
whose PDF isn't in the release yet is hidden (the build log says which), so nothing links to a missing
file. GitHub Pages sites can be up to 1 GB, so there's room for a few hundred sets of notes; past that,
the files can move to Cloudflare R2 by changing where `syncFiles` downloads from.

## Adding a batch (you)

1. Put the PDFs in a zip. Folders and text files are optional hints that save guessing:

   ```
   batch.zip
     info.txt                 applies to everything in the zip
     CS341/                   a folder named for a course: its PDFs are that course's
       W25 midterm.pdf        a PDF on its own is one resource
       W25 midterm.txt        applies to this one PDF (also: W25 midterm.pdf.txt)
       jdoe-F24/              a folder whose info.txt says "set:" is one resource:
         info.txt               its PDFs in name order (ch2 before ch10), then its links
         ch1.pdf
         ch2.pdf
         ch2.txt                this PDF's own title and page notes
         ch10.pdf
     CS240/
       info.txt               links on their own: each "link:" line is one resource
   ```

   Each text file is `key: value` lines, then `note:` and free text to the end. Lines like
   `p. 34: Typo in Lemma 2` anywhere become page notes. `link:` can repeat. A file with no keys is all note.

   ```
   set: CS 341 course notes
   by: Prof. Jane Doe
   term: Fall 2024
   kind: notes
   permission: Shared by the author, October 2026
   link: Course website | https://cs.uwaterloo.ca/~jdoe/cs341/
   link: Lecture recordings | https://www.youtube.com/playlist?list=…
   note:
   One PDF per chapter, as posted in Fall 2024; chapter 7 was dropped from the course in Winter 2025.
   ```

   To add to a set later (chapter 11 once it's out), zip a folder with just the new PDFs and the same
   `info.txt`: they join the set already on the site, in title order, and the earlier parts keep their pages.

   Kinds: `notes`, `slides`, `assignments`, `midterm`, `final`, `exam`, `solutions`, `cheatsheet`,
   `outline`, `textbook`, `other`. Terms can be written `Fall 2024`, `F24` or `1249`.

2. Start a new chat (so this one stays short), attach the zip, and say:

   > Catalogue these for uwloo.ca, following tools/resources/README.md in UmarPatel77/uwloo.ca.

3. You get back two zips:
   - `uwloo-files.zip`: the PDFs, renamed `{id}.pdf`. Unzip it, then on GitHub open
     **Releases → Course resource files → Edit (pencil)**, drag the PDFs into the attachments box,
     and click **Update release**. Do this first.
   - `uwloo.ca-update.zip`: the catalogue changes. Apply and push it the usual way:

     ```
     cd C:\Users\umara\Downloads\uwloo.ca\uwloo.ca
     git pull --no-rebase --no-edit
     Expand-Archive -Path $HOME\Downloads\uwloo.ca-update.zip -DestinationPath . -Force
     git add .
     git commit -m "Resources: <what>"
     git push
     ```

   The push rebuilds the site. If the PDFs went up after the push, the next daily build picks them up
   (or run the workflow from the Actions tab).

**Permission.** Host only files you made, or ones whose author agreed. Lecture notes, slides and exams
belong to whoever wrote them. Without permission, give the `url` where the author posts them and the
entry becomes a link instead. Never include marked work with someone's name or student number on it.

## Cataloguing a batch (Claude, in a fresh chat)

Work from the extracted text in `drafts.json`, not by opening every PDF: that keeps the chat small.

1. Get the repo: attach `UmarPatel77/uwloo.ca` (read access is enough) and clone it, or
   `git fetch && git reset --hard origin/main` if it's already there.
2. Prepare, with the zip from the user's uploads and a scratch folder:

   ```sh
   python3 -I tools/resources/intake.py prepare /path/to/batch.zip "$SCRATCH/work" --repo .
   ```

   It unzips safely, hashes each PDF (its file id is the first 12 hex digits of its SHA-256), counts
   pages, extracts text (OCR for the first two pages of a scan; add `--ocr` for the whole thing), reads
   the hint files and writes `work/drafts.json`: one draft per resource, its PDFs and links in `parts`.
   Fields not given by a hint file are listed in `_guessed`. Each PDF part has `_first_pages` (the start
   of its text), `_codes_in_text` (the codes it mentions most) and `_title_from` (where its title came
   from). `_already_catalogued` marks a file that's in the catalogue already; adding it again updates it.

3. Review each draft in `drafts.json`. Check every guessed field against `_first_pages`. Look at page 1
   (`pdftoppm -f 1 -l 1 -r 80 -png file.pdf p1`) only when the text doesn't settle it, as with scans.
   - `codes`: the course, plus any cross-listed codes the PDF itself names. First code = the page it lives on.
   - `title`: a clean name like "CS 341 course notes", "Midterm, Winter 2025", "Assignment 3 solutions".
   - Sets: each part needs a short `title` ("Chapter 3: Greedy algorithms", "Lecture 12", "Course website").
     Group or split drafts if the folders didn't: PDFs that belong together (A1 to A5 and their solutions)
     are one draft's `parts`; unrelated ones are separate drafts. Order `parts` the way a reader goes through
     them.
   - `by`, `term`, `kind`: from the PDF or the hints. Leave a field empty rather than guess.
   - `note`: one to three sentences on what it covers and how it fits the course, using only what the PDF
     and the user's note say. Keep the user's own wording when they gave a note.
   - `page_notes`: only from the user's notes, or facts plain from the PDF.
   - `permission`: from the hints. If any hosted draft lacks it, ask the user once for the whole batch.
     With no permission, either set `file` to null and give the `url` where it's posted, or set
     `"skip": true`.
   - Set `"skip": true` on anything that shouldn't go up (someone's marked work, duplicates).

   A link with no PDF is a part with a `url` and no `file`. A PDF part can have a `url` too: where the
   original lives.

4. Add, test, and hand over:

   ```sh
   python3 -I tools/resources/intake.py add "$SCRATCH/work" --repo .
   npm test
   ```

   `add` validates every entry, picks each page name (`1249-notes`, then `1249-notes-2`…) and part number,
   writes `data/resources/` and makes `work/uwloo.ca-update.zip` and `work/uwloo-files.zip`. A draft that
   shares a PDF or link with a resource already on the site (or names its `id`) is added to that resource
   instead of becoming a new one. Send the user both zips and the list of new pages, with the steps in
   "Adding a batch" above.

## Catalogue fields

A resource:

| Field | | |
| --- | --- | --- |
| `id` | required | 12 hex digits: its first PDF's file id (or its first link's hash); never changes |
| `codes` | required | `["CS341"]`; the first decides the page: `/cs341/…` |
| `slug` | required | page name: `1249-notes`, `final-2`; set by `add`, never changes once published |
| `kind` | required | one of the kinds above |
| `title` | required | |
| `by`, `term` | optional | `term` is a term code, `"1249"` |
| `permission` | if any PDF | who allowed hosting it and when, shown on its pages |
| `note` | optional | paragraphs split by blank lines; `[text](https://…)` and bare links work; course codes link |
| `added` | required | `2026-10-10` |
| `parts` | required | its PDFs and links, in reading order |

A part:

| Field | | |
| --- | --- | --- |
| `n` | required | its page number, `/cs341/1249-notes/{n}/` (the first PDF is also at `/cs341/1249-notes/`); never reused |
| `title` | in a set | "Chapter 3: Greedy algorithms" |
| `file` | a PDF | `"{file id}.pdf"`, an asset on the "files" release |
| `pages`, `page_notes` | a PDF | `{"34": "Typo in Lemma 2"}`; each links to that page of this PDF |
| `url` | a link | where it lives (for a PDF: where the original is, optional) |
| `kind` | optional | when a part differs from its resource ("solutions" in a set of assignments) |

## Removing one

Every card and page has a "Remove this" link that opens a GitHub issue. To act on it, delete the
resource (or just the part) from `data/resources/{SUBJ}.json` and its `data/resources/text/{file id}.txt`,
push, and delete `{file id}.pdf` from the release. Deleting a release asset removes the file for good,
unlike deleting a file from git. Don't renumber the other parts: their `n` is their address.
