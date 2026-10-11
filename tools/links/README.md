# Link finder

Finds course resources around the web for the "Around the web" list under each course's Resources:
course websites, notes, slides, lecture videos, cheat sheets and past exams. What it found is in
`data/links/found.json`; the site rebuild reads it.

```
.github/workflows/find-links.yml   weekly (Sunday), from the Actions tab, or when the sources change
scripts/find-links.mjs             looks, checks, writes data/links/found.json
scripts/lib/links.mjs              the rules: course codes, robots.txt, what's skipped, kinds, terms
data/links/sources.json            where to look: link lists, webrings, department directories, course sites, GitHub searches
data/links/seeds/reddit.json       links from r/uwaterloo, made once by tools/links/reddit_links.py
data/links/removed.txt             links and sites never to list
```

## Where it looks

| Source | How |
| --- | --- |
| r/uwaterloo | Links posted next to a course code (2009 to 2024, from the dump). A link that names a course is a candidate; a front page (a notes site, an exam bank) is opened for links that do. |
| Link lists | Students' Markdown lists with a section per course (`UWaterloo-Links-SE`). |
| Webrings | The CS, SE and ECE webrings' member lists. Each member's front page, and up to five of its pages about notes, courses or school, for links naming a course. |
| Faculty | Department directories → each professor's or lecturer's profile → their personal site → its teaching pages → course pages. |
| Course sites | `student.cs.uwaterloo.ca/~cs341/` for CS, SE and CM courses; `ece.uwaterloo.ca/~ece327/` for ECE. |
| GitHub | Repository search for Waterloo course notes. Only repositories that say Waterloo, name a course, and look like notes. |

## What gets listed

A candidate is listed when its page loads and names the course: in its title, heading, text or
address (for a PDF, its address or the link to it). Course codes in prose count in capitals only
(`CS 341`, `C&O 350`), and only codes in uwloo's calendars. It's left out when:

- it's assignments, solutions, homework or projects, unless it's on the course's own website;
- it's on a skipped site: social media, uwloo's own sources (calendars, uwflow), sign-in pages, homework
  marketplaces, file lockers (Dropbox, Google Drive) whose contents can't be checked, or another
  university;
- robots.txt says no, or it's in `removed.txt`.

A link that's gone (404, or the site no longer exists) is listed as its Wayback Machine copy when there
is one, and dropped otherwise. A site that's only down this week keeps last week's listing; anything
not rechecked for 60 days drops off.

Deep links into a course account (`~cs245/w17/assign5.html`) become the account's front page, since
those pages change every term.

## Manners

It sends `uwloo-links/1.0 (+https://uwloo.ca/about/links/)`, follows robots.txt (including
`Crawl-delay`), fetches one page at a time per site with at least a second in between, reads at most
1.5 MB of a page, and opens at most 1,500 pages per site per run. Pages are cached in `.cache/links/`
(kept between runs by the Actions cache) for three weeks, profiles for two months, so a weekly run
mostly rechecks. A run gets 100 minutes: 60% for looking, the rest for checking.

## Removing a link

The "Remove" link next to each listing opens an issue. Add the link to `data/links/removed.txt` and
push; the next build hides it, and the finder never lists it again:

```
https://example.com/page       that page
https://example.com/notes/*    everything under it
example.com                    a whole site
```

## Adding sources

Edit `data/links/sources.json` and push; the finder runs on its own afterwards. A webring needs its
member list's raw URL (a file with `name` and `website` fields); a directory, a department's contacts
page on uwaterloo.ca; a course-site pattern, a URL with `{code}` (`cs341`).

To refresh the Reddit seeds from a newer dump:

```sh
pip install zstandard
python -I tools/links/reddit_links.py uwaterloo_submissions.zst uwaterloo_comments.zst
```

## Running it locally

```sh
node scripts/find-links.mjs --minutes 20 --only webrings,lists
node scripts/find-links.mjs --courses dist/search.json     # course list from a local build instead of uwloo.ca
```

`--only` takes any of `reddit,lists,webrings,faculty,sites,github` (GitHub needs `GITHUB_TOKEN`).
