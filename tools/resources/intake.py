#!/usr/bin/env python3
"""Catalogue course-resource PDFs and links for uwloo.ca. See README.md in this folder for the whole flow.

  python3 -I tools/resources/intake.py prepare BATCH.zip WORK      unzip, hash, extract text, guess fields
      → WORK/drafts.json (one draft per resource; a set's PDFs and links are its parts, in order),
        WORK/files/{file id}.pdf, WORK/text/{file id}.txt
  (review WORK/drafts.json: codes, term, kind, titles, by, note, permission)
  python3 -I tools/resources/intake.py add WORK [--repo .]         validate and merge into data/resources/
      → data/resources/{SUBJ}.json, data/resources/text/{file id}.txt,
        WORK/uwloo.ca-update.zip (catalogue changes, to push) and WORK/uwloo-files.zip (PDFs, for the release)

Needs pdfinfo and pdftotext (poppler-utils); pdftoppm and tesseract for scanned PDFs.
Zips are treated as untrusted: paths are sanitised and nothing in them is run.
"""
import argparse
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

KINDS = ['notes', 'slides', 'assignments', 'midterm', 'final', 'exam', 'solutions', 'cheatsheet', 'outline', 'textbook', 'site', 'videos', 'other']
KIND_WORDS = [  # first match wins, checked against the file name, then the first pages
    ('cheatsheet', r'cheat\s*-?\s*sheet|formula sheet|crib sheet|aid sheet'),
    ('solutions', r'solutions?\b|\bsoln?s?\b|answer key'),
    ('midterm', r'mid-?term'),
    ('final', r'\bfinal (exam|examination)\b|\bfinal\b'),
    ('exam', r'\bexam\b|\bquiz\b|\btest\b'),
    ('assignments', r'assignment|\bhomework\b|\bhw\s?\d|\ba\d\b|problem set'),
    ('outline', r'course outline|syllabus'),
    ('slides', r'slides?\b|lecture \d+|deck'),
    ('notes', r'notes?\b|course notes|lecture notes|textbook'),
]
CODE_RE = re.compile(r'\b([A-Z]{2,8}) ?(\d{3}[A-Z]{0,2})\b')
NOT_SUBJECTS = {'PAGE', 'FALL', 'WINTER', 'SPRING', 'ROOM', 'MC', 'DC', 'RCH', 'STC', 'MAY', 'JAN', 'SEPT', 'SEP', 'OCT', 'NOV', 'DEC', 'FEB', 'MAR', 'APR', 'JUN', 'JUL', 'AUG', 'ISBN', 'PDF', 'ID', 'FIG', 'EQ', 'NO'}
SEASON = {'w': '1', 'winter': '1', 's': '5', 'spring': '5', 'summer': '5', 'f': '9', 'fall': '9', 'autumn': '9'}
TERM_RE = re.compile(r'\b(winter|spring|summer|fall|autumn)\s*(?:term\s*)?(20\d\d|19\d\d)\b|\b([WSF])(\d\d)\b|\b(1\d\d[159])\b', re.I)
SLUG_RE = re.compile(r'^(\d{3}[159]-)?[a-z]+(-\d+)?$')
ENTRY_KEYS = ['id', 'codes', 'slug', 'kind', 'title', 'by', 'term', 'permission', 'note', 'added', 'parts']
PART_KEYS = ['n', 'title', 'kind', 'file', 'pages', 'url', 'page_notes']
INFO_KEYS = r'by|term|kind|permission|codes?|title|url|set|link|note'


def sha12(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:12]


def url_id(url):
    return hashlib.sha256(url.encode()).hexdigest()[:12]


def term_code(year, season_digit):
    return f'{int(year) // 100 - 19}{int(year) % 100:02d}{season_digit}'


def parse_term(s):
    """'Fall 2024', 'F24', '1249' → '1249' (None when it isn't a term)."""
    m = TERM_RE.search(str(s or ''))
    if not m:
        return None
    if m.group(1):
        return term_code(m.group(2), SEASON[m.group(1).lower()])
    if m.group(3):
        return term_code(2000 + int(m.group(4)), SEASON[m.group(3).lower()])
    return m.group(5)


def natural(s):
    """'ch2' before 'ch10'."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', str(s))]


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, check=False, **kw)


def pdf_info(pdf):
    out = run(['pdfinfo', str(pdf)]).stdout
    pages = re.search(r'^Pages:\s+(\d+)', out, re.M)
    title = re.search(r'^Title:[ \t]*(.*)$', out, re.M)
    t = title.group(1).strip() if title else ''
    # Producer junk like "Microsoft Word - ch3.docx" or "untitled" isn't a title.
    if re.search(r'^(untitled|microsoft (word|powerpoint)|slide ?\d*$)|\.(docx?|pptx?|tex|dvi)$', t, re.I) or len(t) < 3:
        t = ''
    return (int(pages.group(1)) if pages else None), t


def pdf_text(pdf, ocr_pages=0, tmp=None):
    """pdftotext output (pages split by \\f). Scanned pages get Tesseract OCR, up to `ocr_pages` of them."""
    text = run(['pdftotext', '-enc', 'UTF-8', str(pdf), '-']).stdout
    pages = text.split('\f')
    if ocr_pages and tmp:
        tmp.mkdir(parents=True, exist_ok=True)
        done = 0
        for i, p in enumerate(pages[:-1] if pages and not pages[-1].strip() else pages):
            if len(p.strip()) >= 40 or done >= ocr_pages:
                continue
            base = tmp / f'p{i + 1}'
            run(['pdftoppm', '-r', '200', '-gray', '-png', '-f', str(i + 1), '-l', str(i + 1), '-singlefile', str(pdf), str(base)])
            if (base.with_suffix('.png')).exists():
                pages[i] = run(['tesseract', str(base.with_suffix('.png')), '-', '--psm', '3']).stdout
                base.with_suffix('.png').unlink()
            done += 1
    return '\f'.join(pages)


def parse_link(value):
    """'Course site | https://…', 'https://… | Course site' or a bare 'https://…' → (title or None, url)."""
    bits = [b.strip() for b in value.split('|')]
    url = next((b for b in bits if re.match(r'https?://\S+$', b)), None)
    title = next((b for b in bits if b and b != url), None)
    return (title, url) if url else None


def read_info(path):
    """info.txt, note.txt or {pdf name}.txt. 'key: value' lines (by, term, kind, permission, codes, title, url,
    set, link), then 'note:' and free text to the end; 'p. 34: …' lines anywhere are page notes; 'link:' can
    repeat. A file with no keys at all is all note."""
    info, note, pnotes, links, in_note, keyed = {}, [], {}, [], False, False
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        pm = re.match(r'^\s*p(?:age)?\.?\s*(\d+)\s*[:\-–]\s*(.+)$', line, re.I)
        if pm:
            pnotes[pm.group(1)] = pm.group(2).strip()
            continue
        if in_note:
            note.append(line)
            continue
        km = re.match(rf'^\s*({INFO_KEYS})\s*:\s*(.*)$', line, re.I)
        if km:
            keyed = True
            key = km.group(1).lower()
            key = 'codes' if key in ('code', 'codes') else key
            value = km.group(2).strip()
            if key == 'note':
                in_note = True
                if value:
                    note.append(value)
            elif key == 'link':
                if parse_link(value):
                    links.append(parse_link(value))
            else:
                info[key] = value
        elif not keyed or line.strip():
            note.append(line)
    if note and '\n'.join(note).strip():
        info['note'] = '\n'.join(note).strip()
    if pnotes:
        info['page_notes'] = pnotes
    if links:
        info['links'] = links
    return info


def codes_from(s):
    return [m.group(1) + m.group(2) for m in CODE_RE.finditer(str(s or '').upper()) if m.group(1) not in NOT_SUBJECTS]


def guess_kind(*texts):
    for t in texts:
        for kind, pat in KIND_WORDS:
            if re.search(pat, t or '', re.I):
                return kind
    return None


def clean_name(stem):
    return re.sub(r'\s+', ' ', re.sub(r'[_\-]+', ' ', stem)).strip()


def safe_extract(zpath, dest):
    """Unzip without trusting member paths (no absolute paths, no '..', no links)."""
    with zipfile.ZipFile(zpath) as z:
        for m in z.infolist():
            parts = [p for p in PurePosixPath(m.filename.replace('\\', '/')).parts if p not in ('', '.', '..', '/')]
            if not parts or m.is_dir() or parts[0] == '__MACOSX' or parts[-1].startswith('._'):
                continue
            out = dest.joinpath(*parts)
            out.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as src, open(out, 'wb') as dst:
                shutil.copyfileobj(src, dst)


def load_catalogue(repo):
    """{subject: [entries]} from data/resources/."""
    out = {}
    for f in sorted((repo / 'data/resources').glob('*.json')):
        if re.fullmatch(r'[A-Z]+\.json', f.name):
            out[f.stem] = json.loads(f.read_text(encoding='utf-8'))
    return out


# ---------- prepare ----------

LOCAL = ('set', 'links', 'note', 'page_notes', 'title')  # keys that apply only to the folder that has them


def folder_info(inbox, folder, root_info):
    """Info for one folder: the zip's info.txt, each enclosing folder's info.txt and note.txt, then the
    folder's own. A folder's set, links, note, page notes and title apply to that folder only."""
    info = {k: v for k, v in root_info.items() if k not in LOCAL}
    for f in [*reversed(folder.parents)][1:]:  # enclosing folders, outermost first (the zip's root is root_info)
        for name in ('info.txt', 'note.txt'):
            if (inbox / f / name).exists():
                info.update({k: v for k, v in read_info(inbox / f / name).items() if k not in LOCAL})
    for name in ('info.txt', 'note.txt'):
        if (inbox / folder / name).exists():
            info.update(read_info(inbox / folder / name))
    return info


def prepare(src, work, repo, ocr_all):
    work.mkdir(parents=True, exist_ok=True)
    inbox = work / 'in'
    if inbox.exists():
        shutil.rmtree(inbox)
    if src.is_dir():
        shutil.copytree(src, inbox)
    else:
        safe_extract(src, inbox)
    (work / 'files').mkdir(exist_ok=True)
    (work / 'text').mkdir(exist_ok=True)
    known_files = {p['file']: f"{e['codes'][0]} {e['slug']}" for es in load_catalogue(repo).values() for e in es for p in e['parts'] if p.get('file')}
    root_info = read_info(inbox / 'info.txt') if (inbox / 'info.txt').exists() else {}

    folders = {}
    for p in inbox.rglob('*'):
        if p.is_file() and (p.suffix.lower() == '.pdf' or p.name in ('info.txt', 'note.txt')):
            folders.setdefault(p.parent.relative_to(inbox), []).append(p)
    seen, drafts = {}, []

    def pdf_part(pdf, info, first):
        rel = pdf.relative_to(inbox)
        id_ = sha12(pdf)
        if id_ in seen:
            print(f'  same file twice: {rel} = {seen[id_]}, skipped')
            return None
        seen[id_] = str(rel)
        own = {}
        for side in (pdf.with_suffix('.txt'), pdf.with_name(pdf.name + '.txt')):
            if side.exists():
                own.update(read_info(side))
        pages, meta_title = pdf_info(pdf)
        text = pdf_text(pdf, ocr_pages=(pages or 0) if ocr_all else 2, tmp=work / 'ocr')
        shutil.copyfile(pdf, work / 'files' / f'{id_}.pdf')
        (work / 'text' / f'{id_}.txt').write_text(text, encoding='utf-8')
        head = '\n'.join(text.split('\f')[:2])
        part = {
            'title': own.get('title') or meta_title or clean_name(pdf.stem),
            'file': f'{id_}.pdf',
            'pages': pages,
            'url': own.get('url'),
            'page_notes': own.get('page_notes') or (info.get('page_notes') if first else None),
            '_source': str(rel),
            '_title_from': 'info' if own.get('title') else 'pdf metadata' if meta_title else 'file name',
            '_codes_in_text': [c for c, _ in Counter(codes_from(head)).most_common(3)],
            '_scanned': sum(len(x.strip()) for x in text.split('\f')[:3]) < 120,
            '_first_pages': head[: 1800 if first else 600],
        }
        if part['file'] in known_files:
            part['_already_catalogued'] = known_files[part['file']]
        return part, own, head

    def draft(info, parts, own, head, name, where):
        guessed = [k for k in ('codes', 'term', 'kind', 'title') if not (own.get(k) or info.get(k) or (k == 'title' and info.get('set')))]
        folder_codes = [c for bit in where.parts for c in codes_from(bit)]
        text_codes = parts[0].get('_codes_in_text', []) if parts else []
        codes = codes_from(own.get('codes') or info.get('codes') or '') or folder_codes or codes_from(clean_name(name)) or text_codes[:1]
        d = {
            'codes': list(dict.fromkeys(codes)),
            'kind': next((k for k in (own.get('kind'), info.get('kind')) if k in KINDS), None) or guess_kind(clean_name(name), head[:1500]) or 'other',
            'title': own.get('title') or info.get('set') or info.get('title') or clean_name(name),
            'by': own.get('by') or info.get('by'),
            'term': parse_term(own.get('term') or info.get('term')) or parse_term(clean_name(name)) or parse_term(head),
            'permission': own.get('permission') or info.get('permission'),
            'note': own.get('note') or info.get('note'),
            'parts': parts,
            '_source': str(where) + '/',
            '_guessed': guessed,
        }
        return d

    for folder in sorted(folders, key=lambda f: natural(str(f))):
        info = folder_info(inbox, folder, root_info)
        pdfs = sorted((p for p in folders[folder] if p.suffix.lower() == '.pdf'), key=lambda p: natural(p.name))
        links = info.get('links', [])
        if info.get('set'):
            # One resource: the folder's PDFs in name order, then its links.
            parts, own, head = [], {}, ''
            for i, pdf in enumerate(pdfs):
                got = pdf_part(pdf, info, i == 0)
                if got:
                    parts.append(got[0])
                    if i == 0:
                        head = got[2]
            parts += [{'title': t or None, 'url': u} for t, u in links]
            if parts:
                drafts.append(draft(info, parts, {}, head, folder.name or info['set'], folder))
            continue
        lone = len(pdfs) == 1 and not links
        # A folder's title, note and page notes name its PDF only when it's the only one there.
        pinfo = info if lone else {k: v for k, v in info.items() if k not in ('title', 'note', 'page_notes')}
        for pdf in pdfs:
            got = pdf_part(pdf, pinfo, True)
            if not got:
                continue
            part, own, head = got
            title = part.pop('title')
            if part['_title_from'] != 'file name':
                own = {**own, 'title': own.get('title') or title}
            d = draft(pinfo, [part], own, head, pdf.stem, folder)
            drafts.append(d)
        for t, u in links:  # a link on its own
            name = t or clean_name(re.sub(r'\.(pdf|html?)$', '', u.rstrip('/').rsplit('/', 1)[-1], flags=re.I)) or u
            drafts.append(draft(pinfo, [{'url': u}], {'title': t} if t else {}, '', name, folder))

    for d in drafts:
        kinds = f"{','.join(d['codes']) or '?'} {d['term'] or '?'} {d['kind']}"
        pdfs = sum(1 for p in d['parts'] if p.get('file'))
        links = len(d['parts']) - pdfs
        flag = ' (has files already catalogued)' if any('_already_catalogued' in p for p in d['parts']) else ''
        print(f"  {d['_source']:<28} {d['title'][:40]:<40} {kinds}  {pdfs} PDF(s), {links} link(s){flag}")
    (work / 'drafts.json').write_text(json.dumps(drafts, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'{len(drafts)} draft(s) in {work / "drafts.json"}. Review them, then: intake.py add {work}')


# ---------- add ----------

def check(e):
    """Same rules as validate() in scripts/lib/resources.mjs."""
    errs = []
    if not re.fullmatch(r'[0-9a-f]{12}', e.get('id') or ''):
        errs.append('id')
    if not e.get('codes') or not all(re.fullmatch(r'[A-Z]{2,8}\d{3}[A-Z]{0,2}', c) for c in e['codes']):
        errs.append('codes (like ["CS341"])')
    if e.get('kind') not in KINDS:
        errs.append(f'kind (one of {", ".join(KINDS)})')
    if not (e.get('title') or '').strip():
        errs.append('title')
    if e.get('term') and not re.fullmatch(r'\d{3}[159]', e['term']):
        errs.append('term (a term code like "1249")')
    parts = e.get('parts') or []
    if not parts:
        errs.append('parts (at least one PDF or link)')
    for i, p in enumerate(parts):
        if len(parts) > 1 and not (p.get('title') or '').strip():
            errs.append(f'parts[{i}].title (each part of a set needs one)')
        if not p.get('file') and not p.get('url'):
            errs.append(f'parts[{i}]: a file or a url')
        if p.get('url') and not re.fullmatch(r'https?://\S+', p['url']):
            errs.append(f'parts[{i}].url')
        if p.get('kind') and p['kind'] not in KINDS:
            errs.append(f'parts[{i}].kind')
        for k in (p.get('page_notes') or {}):
            if not re.fullmatch(r'[1-9]\d*', str(k)) or (p.get('pages') and int(k) > p['pages']):
                errs.append(f'parts[{i}].page_notes["{k}"]')
    if any(p.get('file') for p in parts) and not (e.get('permission') or '').strip():
        errs.append('permission (who allowed hosting the PDFs, and when; or drop their "file" and give each a url to link instead)')
    return errs


def clean_part(p):
    out = {k: p[k] for k in PART_KEYS if p.get(k) not in (None, '', {}, [])}
    if 'page_notes' in out:
        out['page_notes'] = {str(k): v for k, v in sorted(out['page_notes'].items(), key=lambda kv: int(kv[0]))}
    if not out.get('file'):
        out.pop('pages', None)
        out.pop('page_notes', None)
    return out


def clean(e):
    out = {k: e[k] for k in ENTRY_KEYS if e.get(k) not in (None, '', {}, [])}
    out['parts'] = [clean_part(p) for p in e['parts']]
    return out


def part_key(p):
    return p.get('file') or p.get('url')


def add(work, repo):
    drafts = json.loads((work / 'drafts.json').read_text(encoding='utf-8'))
    catalogue = load_catalogue(repo)
    by_id = {e['id']: (subj, e) for subj, es in catalogue.items() for e in es}
    by_part = {part_key(p): e['id'] for es in catalogue.values() for e in es for p in e['parts']}
    used = {(e['codes'][0], e['slug']) for es in catalogue.values() for e in es}
    today = datetime.date.today().isoformat()
    done, problems, files, touched = [], [], [], set()
    for d in drafts:
        if d.get('skip'):
            continue
        d['codes'] = [re.sub(r'\s+', '', c).upper() for c in d.get('codes') or []]
        if d.get('term'):
            d['term'] = parse_term(d['term']) or d['term']
        parts = [p for p in d.get('parts') or [] if not p.get('skip')]
        if len(parts) == 1 and parts[0].get('title') == d.get('title'):
            parts[0] = {k: v for k, v in parts[0].items() if k != 'title'}
        # An entry already in the catalogue, named by "id", found through a file or link it already has, or
        # a set with the same course, title and term:
        # its parts are updated and new ones added (PDFs after its last PDF, links at the end). Nothing is
        # removed here; to drop a part, delete it from data/resources/{SUBJ}.json.
        old_id = (
            (d.get('id') if d.get('id') in by_id else None)
            or next((by_part[part_key(p)] for p in parts if part_key(p) in by_part), None)
            # the same set again (same course, title and term), with new PDFs only
            or next((i for i, (_, x) in by_id.items() if d['codes'][:1] == x['codes'][:1] and d.get('title') == x['title'] and d.get('term') == x.get('term') and len(parts) and len(x['parts']) > 1), None)
        )
        old = by_id[old_id][1] if old_id else None
        if old:
            mine = {part_key(p): i for i, p in enumerate(old['parts'])}
            merged = [dict(p) for p in old['parts']]
            next_n = max(p['n'] for p in old['parts']) + 1
            new_pdfs, new_links = [], []
            for p in parts:
                if part_key(p) in mine:
                    i = mine[part_key(p)]
                    merged[i] = {**merged[i], **{k: v for k, v in p.items() if v not in (None, '', {}, []) and k != 'n'}}
                else:
                    (new_pdfs if p.get('file') else new_links).append({**p, 'n': next_n})
                    next_n += 1
            last_pdf = max((i for i, p in enumerate(merged) if p.get('file')), default=-1)
            old_pdfs = merged[: last_pdf + 1]
            by_title = lambda p: natural(p.get('title') or '')
            if new_pdfs and all(p.get('file') for p in old_pdfs) and old_pdfs == sorted(old_pdfs, key=by_title):
                # PDFs in title order (Chapter 2 before Chapter 10) stay that way: Chapter 3 goes between them.
                old_pdfs = sorted(old_pdfs + new_pdfs, key=by_title)
                new_pdfs = []
            merged = old_pdfs + new_pdfs + merged[last_pdf + 1 :] + new_links
            e = {**old, **{k: v for k, v in d.items() if k in ENTRY_KEYS and k not in ('parts', 'id') and v not in (None, '', {}, [])}, 'parts': merged}
            e['id'], e['slug'], e['added'] = old['id'], old['slug'], old['added']
        else:
            parts = [{**p, 'n': i + 1} for i, p in enumerate(parts)]
            first = parts[0] if parts else {}
            e = {**{k: d.get(k) for k in ENTRY_KEYS}, 'parts': parts, 'added': today}
            e['id'] = (first.get('file') or '')[:12] or (url_id(first['url']) if first.get('url') else None)
        errs = check(e)
        if errs:
            problems.append(f"{d.get('_source') or d.get('title')}: fix {', '.join(errs)}")
            continue
        if not old:
            base = f"{e['term']}-{e['kind']}" if e.get('term') else e['kind']
            slug, n = base, 2
            while (e['codes'][0], slug) in used:
                slug, n = f'{base}-{n}', n + 1
            e['slug'] = slug
        if old:
            osubj = by_id[old_id][0]
            catalogue[osubj] = [x for x in catalogue[osubj] if x['id'] != old['id']]
            touched.add(osubj)
            used.discard((old['codes'][0], old['slug']))
        if (e['codes'][0], e['slug']) in used or not SLUG_RE.fullmatch(e['slug']):
            problems.append(f"{d.get('_source') or e['id']}: page /{e['codes'][0].lower()}/{e['slug']}/ is taken")
            continue
        used.add((e['codes'][0], e['slug']))
        e = clean(e)
        subj = re.match(r'[A-Z]+', e['codes'][0]).group(0)
        catalogue.setdefault(subj, []).append(e)
        by_id[e['id']] = (subj, e)
        for p in e['parts']:
            by_part[part_key(p)] = e['id']
        touched.add(subj)
        for p in e['parts']:
            if not p.get('file'):
                continue
            fid = p['file'][:12]
            src = work / 'text' / f'{fid}.txt'
            if src.exists() and src.read_text(encoding='utf-8').strip():
                (repo / 'data/resources/text').mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, repo / 'data/resources/text' / f'{fid}.txt')
                touched.add(f'text/{fid}')
            if (work / 'files' / p['file']).exists():
                files.append(p['file'])
        done.append(e)
        pdfs = [p for p in e['parts'] if p.get('file')]
        print(f"  {'updated' if old else 'added'}  /{e['codes'][0].lower()}/{e['slug']}/  {e['title']}  ({len(pdfs)} PDF(s), {len(e['parts']) - len(pdfs)} link(s))")
    if problems:
        print('Not added; fix these in drafts.json and run add again:\n  ' + '\n  '.join(problems))
    (repo / 'data/resources').mkdir(parents=True, exist_ok=True)
    for subj in sorted(s for s in touched if '/' not in s):
        entries = sorted(catalogue.get(subj, []), key=lambda e: (e['codes'][0], e['slug']))
        path = repo / 'data/resources' / f'{subj}.json'
        if entries:
            path.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        elif path.exists():
            path.write_text('[]\n', encoding='utf-8')
    # The two things to hand over: the catalogue changes (pushed with git) and the PDFs (for the release).
    if done:
        with zipfile.ZipFile(work / 'uwloo.ca-update.zip', 'w', zipfile.ZIP_DEFLATED) as z:
            for t in sorted(touched):
                rel = f'data/resources/{t}.json' if '/' not in t else f'data/resources/{t}.txt'
                z.write(repo / rel, rel)
        if files:
            with zipfile.ZipFile(work / 'uwloo-files.zip', 'w', zipfile.ZIP_STORED) as z:
                for f in sorted(set(files)):
                    z.write(work / 'files' / f, f)
        print(f"{len(done)} added or updated. Push {work / 'uwloo.ca-update.zip'}" + (f"; upload the {len(set(files))} PDF(s) in {work / 'uwloo-files.zip'} to the files release first." if files else '.'))
    return 1 if problems else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('src', type=Path, help='a zip of PDFs, or a folder')
    p.add_argument('work', type=Path, help='a scratch folder for this batch')
    p.add_argument('--repo', type=Path, default=Path('.'))
    p.add_argument('--ocr', action='store_true', help='OCR every scanned page (default: the first two, for guessing)')
    a = sub.add_parser('add')
    a.add_argument('work', type=Path)
    a.add_argument('--repo', type=Path, default=Path('.'))
    args = ap.parse_args()
    if args.cmd == 'prepare':
        prepare(args.src, args.work, args.repo, args.ocr)
        return 0
    return add(args.work, args.repo)


if __name__ == '__main__':
    sys.exit(main())
