# uwloo.ca

Waterloo course pages at short URLs. A GitHub Action pulls the university's own data once a day and publishes a static site to GitHub Pages.

## URLs

| You type | You get |
| --- | --- |
| `uwloo.ca/cs135`, `uwloo.ca/cs686` (also `/CS135`, `/cs-135`, `/cs/135`) | Course page, undergrad or grad: prerequisites, corequisites, antirequisites, what it leads to, the last 7 terms it ran, this term's and next term's sections with seats, and links out |
| `uwloo.ca/2627/cs` | Every CS course for 2026–27 on one page, ucalendar style: the Undergraduate Calendar's courses, then the Graduate Calendar's (that year's latest term) |
| `uwloo.ca/2627/cs135` | Same page, scrolled to CS 135 |
| `uwloo.ca/1249/cs` | Graduate CS courses exactly as the Fall 2024 Graduate Calendar has them, for every term from Spring 2024 on |
| `uwloo.ca/1249` | All subjects in the Fall 2024 Graduate Calendar |
| `uwloo.ca/1249/math631` | MATH 631 exactly as the Fall 2024 Graduate Calendar lists it, with links for that term (archived entry, acal for 1249). Clicking a course on `/1249/math` lands here |
| `uwloo.ca/1109/co`, any term from `1069` (Fall 2006) to `1241` (Winter 2024) | Graduate C&O courses as that term's Graduate Calendar had them, read from Waterloo's archived copy; `/1109/co602` jumps to CO 602. Terms uwloo hasn't read go to that term in Waterloo's archive |
| `uwloo.ca/cs` | The current calendar year's CS page |
| `uwloo.ca/2627` | All subjects in the 2026–27 calendar |
| `uwloo.ca/2324/cs`, `2021` to `2324` | That year's CS courses on uwloo, with the original ucalendar page linked at the top; `/2324/cs135` jumps to CS 135. 2022–23 and 2023–24 are read from ucalendar; 2020–21 and 2021–22 from Open Data's course catalog (ucalendar's robots.txt asks programs to stay out of those years) |
| `uwloo.ca/1920/cs`, any year from `9596` to `1920` | Redirects to `ucalendar.uwaterloo.ca/1920/COURSE/course-CS.html` (`/1920/cs135` → `…#CS135`) |
| `uwloo.ca/1920`, any year from `9596` to `1920` | That year's front page where Waterloo's archives page links it: `academic-calendar-archive.uwaterloo.ca` for 2007–08 on (ucalendar's own front pages for those years are gone), `www.ucalendar.uwaterloo.ca/0506/` before that |
| `uwloo.ca/9495/cs`, any year from `6364` to `9495` | That year's CS courses read from the scanned calendar (`/9495/cs241` jumps to CS 241), each linking to its scanned page. Each course links to its scanned page |
| `uwloo.ca/6263/…` and earlier | Not online; says the archive starts at 1963–64 |
| `uwloo.ca/search?q=dynamic+programming` | Courses by what they're about: descriptions, course websites and r/uwaterloo, with related ideas (below). The search box in the header sends anything that isn't a course code here |
| `uwloo.ca/pathways` | Map out a whole degree term by term: plans, prerequisites, course loads, and what's still open (below) |
| `uwloo.ca/programs` | Every major, minor, option, specialization, diploma and certificate in the current Undergraduate Calendar, each with its own page (below) |
| `uwloo.ca/programs/grad` | Every master's, PhD and graduate diploma in the current Graduate Calendar, each with its own page (`/programs/grad/ma-in-economics/`, below) |
| `uwloo.ca/programs/combinations` | Which credentials can't be taken together, from the calendar's Invalid Credential Combinations |
| `uwloo.ca/calendar` | The timetable planner: add up to 8 courses for this term or next, and see the timetables that fit, best first (below) |
| `uwloo.ca/courses.csv` | Every course: title, level, whether it's in the current calendars, the last term it ran (looking back 7 years), and its outline.uwaterloo.ca search link. Opens in Excel |
| `uwloo.ca/1269/cs135` | Redirects to `acal.fast.uwaterloo.ca/course/1269/CS/135` whenever uwloo has no page for it (undergrad codes, and terms uwloo doesn't have) |
| `uwloo.ca/1065` and earlier terms | Says the online Graduate Calendars start at Fall 2006 |
| `uwloo.ca/cs421` (no such course) | "No page here", then the subject's nearest courses: same hundred first, closest number next (CS 418, 431, 440…), courses still offered before ones that aren't. The search box does the same |

Every entry on a calendar page also links to its official entry and to acal for that year or term (the fall term for an undergrad year). A few codes are both a term and a year: `1011` (Winter 2001, or 2010–11), `1415` (Spring 2041, or 2014–15) and `1819` (Fall 2081, or 2018–19). None of those terms has a Graduate Calendar on uwloo, so the year wins.

Undergraduate calendars from 2024–25 and graduate calendars from Spring 2024 come from Kuali and are rebuilt here. New years and terms appear automatically when Waterloo publishes them. Older Graduate Calendars are below.

## Older Undergraduate Calendars (2020–21 to 2023–24)

ucalendar.uwaterloo.ca still has every undergraduate year from 1995–96 to 2023–24, but its robots.txt asks programs to stay out of all of them except 2022–23 and 2023–24. So uwloo hosts:

| Years | Read from |
| --- | --- |
| 2022–23, 2023–24 | ucalendar's `course-{SUBJ}.html` pages, found through each year's Course Descriptions Index on academic-calendar-archive.uwaterloo.ca (which has no robots.txt) |
| 2020–21, 2021–22 | Open Data's course catalog for the year's three terms, newest wording first (Open Data starts at Winter 2020) |
| 1995–96 to 2019–20 | Not read: uwloo links and redirects to ucalendar |

The same job as the grad calendars below reads them into `data/ug-archive/` (one file per year, `terms/2324.json`, plus `entries.json`). Each subject gets a page with the original ucalendar link at the top (`/2324/cs/`), each year an index (`/2324/`), and they join the year links, "Calendar versions" on course pages, and "no longer offered" pages. To read them again after changing the reader, bump `UG_PARSER` in `scripts/lib/ugarchive.mjs`.

## Older Graduate Calendars (Fall 2006 to Winter 2024)

Before Kuali, each grad term's calendar was its own website, and Waterloo keeps them:

| Terms | Where | On uwloo |
| --- | --- | --- |
| Fall 2006 to Fall 2016 | `uwaterloo.ca/gsac-archive/{year}/{season}/`, a saved copy of gradcalendar.uwaterloo.ca. Each department links its course list, `…/SA/GRAD/{YYyy}/GRDcourse-{SUBJ}.html` | Read in full: `/1109/co/` |
| Winter 2017 to Winter 2024 | `academic-calendar-archive.uwaterloo.ca` (the WCMS calendar) | Only if its robots.txt lets uwloo in. Until then, Winter 2020 on uses Open Data's course catalog for the term (`Courses/{term}`, the same source as the history above), and Winter 2017 to Fall 2019 link to Waterloo's archive |

`scripts/grad-archive.mjs` reads them into `data/grad-archive/`: one file per term (`terms/1109.json`) and `entries.json`, where a course that reads the same in twenty terms is stored once. Archives don't change, so it's a one-off: `.github/workflows/grad-archive.yml` runs on push, reads for up to 150 minutes, commits, rebuilds the site, and starts itself again until every term it can read is in. It follows robots.txt, makes one request at a time with a pause, and keeps every page in its Actions cache. `data/grad-archive/report.json` says what it found per term (pages, courses, any header it couldn't read) and what it saw on academic-calendar-archive; `samples/` keeps a few raw pages so the reader can be checked against the real thing.

Each term gets subject pages (`/1109/co/`) and an index (`/1109/`). Course pages list the older terms a course is in under "Calendar versions", marking where its requisites changed, and a grad course that's gone since (in an older calendar but none today) gets a "no longer offered" page from its last entry. Every grad term page has a grid of the older terms. To read terms again after changing the reader, bump `PARSER` in `scripts/lib/gradarchive.mjs` and push; to redo some by hand, run the workflow from the Actions tab with their codes.

## How I intially thought about approaching it
uwloo./[2627≥YYyy≥5758]/[subj] uses new course index uwaterloo.ca/academic-calendar/[(under)graduate]-studies/catalog#/courses/ to replicate ucalendar.uwaterloo.ca/[≤2324]/COURSE/course-[SUBJ].html, and uwloo./[subj][ID][suffix] is an updated version of uwflow.com’s outdated requisites and pathways vs acal.fast.uwaterloo.ca/course/[current or 4#’s:Century less 20 + /YY/ + 1stMofTerm]/[subj]/[ID#] and quest.pecs.uW/psc/PB/ACADEMIC/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL#:~:text=Class,Search and https://classes.uwaterloo.ca/cgi-bin/cgiwrap/infocour/salook.pl?level=under&sess=[4#’s]&subject=[subj]

## Where the data comes from (All AI gen text below) 

| Source | Used for | Key |
| --- | --- | --- |
| Kuali catalog API (`uwaterloocm.kuali.co/api/v1/catalog`), the JSON behind `uwaterloo.ca/academic-calendar/undergraduate-studies/catalog` | Every undergraduate and graduate course, description, requisite, note, and cross-listing, for each calendar year (undergrad) and term (grad) | None |
| UW Open Data API v3 (`openapi.data.uwaterloo.ca/v3`) | Which terms a course ran in, faculty, sections and seats for the current and next term | Free, optional |
| UW Flow's GraphQL API (`uwflow.com/graphql`) | Ratings and the most helpful comments on course pages | None |

"When it runs" (the term strip and "Ran in N of the last 7 terms") comes from `ClassSchedules/{term}`, the terms a course had sections scheduled. It doesn't use the terms field in the course catalog, which lists the terms a course could be offered, not the ones it ran: AMATH 343 is listed for Fall 2025 through Fall 2026 but ran only in Fall 2025. A term with no class schedule counts as unknown, never as "not offered": ahead, it says the schedule isn't out yet, and a past term whose schedule came back empty is asked for again on later builds.

Pages link out to the Schedule of Classes, Quest Class Search, acal, the official calendar entry, course outlines on outline.uwaterloo.ca, and WClasses (wclasses.vercel.app: every section back to 2004, with instructors up to about 2022; it stopped updating in early 2026). Those sites are linked, not scraped: the Schedule of Classes disallows automated access and is being retired, Quest needs a session, and outline.uwaterloo.ca needs a UW login and disallows automated access.

Open Data withholds instructor names and rooms and can trail Quest by up to two days, so the sections table says so and links to the Schedule of Classes for the live view.

## Setup

Most of this is automatic. Every workflow run starts with `scripts/setup.mjs`, which turns on GitHub Pages with source **GitHub Actions**, sets the custom domain from `CNAME`, keeps the Cloudflare DNS records correct, and turns on **Enforce HTTPS** as soon as GitHub has issued the certificate. It only changes what's wrong, so it's safe on every run. Each run's summary page shows a status table.

### One-time steps

1. **Push this folder** to a public GitHub repo on the `main` branch.
2. **Add two tokens** as repository secrets (Settings → Secrets and variables → Actions → New repository secret):

   | Secret | Where to make it | Permissions |
   | --- | --- | --- |
   | `PAGES_ADMIN_TOKEN` | <https://github.com/settings/personal-access-tokens/new> (fine-grained) | Repository access: only this repo. Repository permissions: **Pages** read and write, **Administration** read and write |
   | `CLOUDFLARE_API_TOKEN` | <https://dash.cloudflare.com/profile/api-tokens> → Create Token → template **Edit zone DNS** | Zone resources: include, specific zone, `uwloo.ca` |

   The workflow's built-in token isn't allowed to change Pages settings, which is why the first is needed. Fine-grained tokens expire (a year at most); if it lapses, runs keep deploying and the summary shows a warning until you replace it.
3. **Optional: add `UW_API_KEY`** the same way, for offering history and seats. Keys are requested through the API itself:

   ```sh
   curl -X POST https://openapi.data.uwaterloo.ca/v3/account/register \
     -d 'email=YOU@uwaterloo.ca&project=uwloo.ca&uri=https%3A%2F%2Fuwloo.ca'
   ```

   The email you get has the key and a code; activate it with `POST /v3/account/confirm`, per the [getting started guide](https://github.com/uwaterloo/OpenData/wiki/Home---Getting-Started).

   **Keys stay out of the repo.** It's public, so keys live only in these secrets. `git config core.hooksPath .githooks` (once per clone) turns on a check that refuses a commit containing an Open Data key, a GitHub token, or a long value after a secret's name. The deploy workflow runs the same check over every file, which catches web uploads. `gh secret list` shows the secrets' names and dates; GitHub never shows a saved value again.
4. **Run it.** Actions → "Build and deploy uwloo.ca" → Run workflow. The first build fetches every course in every undergraduate and graduate calendar (about 30–60 minutes); later runs reuse the cache and take a few minutes.
5. **Verify the domain, once.** GitHub has no API for this button. The workflow puts the TXT record in Cloudflare (the code is in `.github/workflows/deploy.yml`), then you click **Verify** at <https://github.com/settings/pages_verified_domains>.

HTTPS is usually ready within an hour of the first run. The next run (daily, or Run workflow) turns on Enforce HTTPS.

### What setup puts in Cloudflare

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| CNAME | `uwloo.ca` | `<owner>.github.io` | DNS only |
| CNAME | `www` | `<owner>.github.io` | DNS only |
| TXT | `_github-pages-challenge-<owner>` | the verification code | — |

Records stay **DNS only** because GitHub can't issue its certificate through Cloudflare's proxy. Other records in the zone are left alone. Without `CLOUDFLARE_API_TOKEN`, setup skips DNS and you add these by hand.

### Without the tokens

Setup still checks things and says what's missing. Set Settings → Pages → Source to **GitHub Actions**, enter `uwloo.ca` under Custom domain, add the DNS records above, and tick Enforce HTTPS when GitHub offers it.

## r/uwaterloo discussions

Each course page has a "Discussed on r/uwaterloo" section: every post and comment that mentions the course, one card per thread, newest first and grouped by term. A card quotes the post, then for each reply that names the course, the comment that started its branch and the reply itself. Quotes are short verbatim excerpts with `u/` attribution, never reworded. "View on Reddit" opens the branch, so every parent comment is there. The page shows 12 threads; "Show all" loads the rest from `/reddit/{code}.json`.

`tools/reddit/index_dump.py` builds `data/reddit/{SUBJ}.json` from the per-subreddit dump (Watchful1's "Subreddit comments/submissions" torrent, files `uwaterloo_submissions.zst` and `uwaterloo_comments.zst`):

```sh
pip install zstandard
python -I tools/reddit/index_dump.py uwaterloo_submissions.zst uwaterloo_comments.zst
```

Course codes count in capitals (`CS 135`, `CS135`, `CS 135/136`, `C&O 250`) or lowercase (`cs135`), except codes that are also words (`me 100`, `fine 100`), which count only in capitals. PD courses have one- or two-digit numbers (`PD 1`, `pd11`, `Pd 5`), and those count in any case. The current data runs from 2009 to December 2024: 132,175 mentions of 4,576 codes. Newer posts need Arctic Shift's API, which is down at the moment, so each section links to a Reddit search for anything newer.

**Removals.** Anything deleted or removed before it was archived is left out. Every card has a "Remove this" link that opens a GitHub issue with the ids involved. To act on one, add a line to `data/reddit/removed.txt` and push:

```
m45lu3j        # a comment (also accepts t1_m45lu3j); a thread starter loses its quote
1hnxrf4        # a post (t3_…): drops its whole thread
u/someone      # everything by that account
```

Reddit's API, which could check daily for deletions, now needs Reddit's approval for new keys, so removals are by request for now.

## UW Flow reviews

Course pages have a "Reviewed on UW Flow" section, folded like the r/uwaterloo one: the share of students who liked the course and found it easy and useful, how many ratings and comments that's from, and up to five comments, most found helpful first, with a link to the rest on UW Flow. Comments are quoted as written, clipped at 700 characters, without names.

`scripts/lib/uwflow.mjs` reads UW Flow's public GraphQL API (the one its own site uses; its robots.txt allows everything), 1,000 rows a request with a pause between, at most once a week, into `.cache/uwflow/flow.json`. If UW Flow can't be reached, the build uses the last copy; with no copy, the section is left out. `UWFLOW=off` skips it.

**Removals.** Each comment has a "Remove this" link that opens a GitHub issue with its review id. Add the id to `data/uwflow/removed.txt` and push.

## Course resources

Course pages can list resources: PDFs that uwloo hosts with the author's permission, and links to notes, slides and past exams posted elsewhere. A resource can be one PDF or a set (chapters, lecture slides, a course site and its recordings), shown as one card. Each hosted PDF gets a page like `/cs341/1249-notes/` or `/cs341/1249-notes/3/`, with the notes about it (what it covers, page notes, how to cite it) and the rest of its set above the PDF itself. The PDF is drawn by PDF.js (`site/viewer.js`, `site/vendor/`), so it shows in the page on phones too instead of downloading.

The catalogue is `data/resources/{SUBJ}.json`; the PDFs are assets on a GitHub release tagged `files` (created by `scripts/setup.mjs`), so they never enter git history, and the build copies them into the site. `tools/resources/README.md` has the whole flow: zip the PDFs, catalogue them in a fresh chat with `tools/resources/intake.py`, upload the PDFs to the release, push the catalogue.

### Found around the web

Under each course's Resources, "Around the web" lists course websites, notes, slides, lecture videos and past exams that a weekly job finds: links posted on r/uwaterloo, the CS, SE and ECE webrings, students' link lists, professors' teaching pages (through department directories), course accounts like `student.cs.uwaterloo.ca/~cs341/`, and GitHub repositories of notes. Each page is checked to load and name the course; assignments and solutions are left out unless they're on the course's own site; dead links become Wayback Machine copies. It follows robots.txt and goes slowly; `/about/links/` explains it to site owners. `tools/links/README.md` has the details, and `data/links/removed.txt` takes links down.

## Past class schedules

`data/schedules/{SUBJ}.json` holds each course's past main sections (lectures, or seminars or labs when it has none) from Spring 2004 to early 2026, with enrolment cap and total, times and instructor. They come from WClasses (wclasses.vercel.app), whose author agreed to uwloo reading it; WClasses read them from the Registrar's Schedule of Classes, which uwloo can't read itself because its robots.txt says no.

The "Past class schedules" workflow (`scripts/schedules.mjs`) reads them in two ways:
- **Today's courses** (from uwloo.ca/courses.csv): one request each, for the course's WClasses page, which has every term.
- **Courses that are gone:** WClasses' API, one request per term, but only over terms they could have run. For undergrad courses in the 1994–95 scanned calendar or the 2020–21 to 2023–24 calendars, that's Spring 2004 to Winter 2020. For grad courses, it's the terms they were listed in the older Graduate Calendars.

It runs three requests at a time and carries on run after run until everything is in. First it checks two answers against what WClasses shows by hand: ECON 355 in Fall 2015 is LEC 001, 60 of 60, Hongxiu Li, and CS 135's page has Fall 2015 lectures. If either check fails, it saves nothing and the run fails. A request that fails is asked again next run; only an empty answer is recorded as asked. A term missing from WClasses means unknown, not "didn't run", since its own scraper skipped failed reads silently.

### On course pages

Every course with saved sections gets an "Every term since 2001" section: one row per year, newest first, with a box for Winter, Spring and Fall.
- **A filled box** ran, and its number is how many lectures (or seminars or labs) it had. Clicking it opens that term's sections under its row (section, enrolled/cap, days and time, building and room, instructor). The address becomes `/econ355#t1159`, and it works without JavaScript (CSS `:target`).
- **A dashed "1:1" box** had only one-student sections (cap 1). Those are individual arrangements, and they don't count as "ran"; they're listed with their professor when WClasses has one.
- **A "·" box** means WClasses has nothing for that term, which isn't proof the course didn't run.

Above the grid: how many terms it ran and in which seasons, and "Taught by" with each instructor's number of terms. The recent strip at the top of the page links its boxes down to the grid. Courses that are no longer offered get the same section, ending at their last year.

"Calendar versions" lists each older undergraduate calendar a course was likely in, as its own uwloo address (`/1920/afm322`, which opens that year's ucalendar entry). The list starts from 1995–96 if the 1994–95 scan has the course, or else from the year it first ran.

### From Fall 2025 on: kept from Open Data

WClasses stopped in early 2026, and Open Data deletes a term's sections about a year after it ends. So the "Term archive" workflow (`scripts/term-archive.mjs`) runs weekly. It saves every term Open Data still has, from Fall 2025 to the term in progress, into `data/terms-od/{term}.json`, shaped like `data/schedules`. A finished term is read once more after it ends and then left alone. The term in progress is read each week, since its enrolment still moves. If more than 5% of a term's requests fail, that term is left as it was, and the next week tries again.

The build lays these terms over WClasses' copy, so Open Data's Spring 2026, with final enrolment, replaces WClasses' early read. Open Data withholds instructors and rooms, so from Fall 2025 on those cells are blank.

## The timetable planner (`/calendar/`)

Add up to 8 courses and uwloo tries every combination of their sections, then shows the timetables that fit, best first. It covers the terms Open Data has sections for (this term, and next term once it's published). It opens on next term, unless this term started under three weeks ago.

- **What counts as a timetable:** one section of each kind a course has (lecture, tutorial, lab, test…). A tutorial or lab goes with the lecture that has the same associated-class number, or with any lecture when its number is 99, the same rule Quest uses. Open Data gives 0 for every section (checked for Winter 2027), so for now any tutorial goes with any lecture; Quest has the final say. Classes can't overlap; ones in different weeks (a lab in the first half of the term, or labs on given dates) can. A test that overlaps a class or another test is allowed but ranked lower and flagged, since instructors arrange another sitting.
- **Best first:** fewer early and late classes (or none before/after the times you pick), the days you want off, short gaps, a free 45 minutes for lunch if you ask, fewer days on campus if you ask, and sections with seats left. Full sections are skipped unless a kind has nothing else.
- **Busy times:** "Block off time", then drag down a day on the timetable, or pick a day and times. No section that meets in a busy time is used.
- **Swap and lock:** each section in the table has a menu of the others that fit (ones that would clash say what with). "Lock" keeps a section in every timetable.
- **Out:** "Copy class numbers" for Quest's shopping cart, an `.ics` file for Google, Apple or Outlook calendars, and a link. In the calendar file, weekly classes repeat over their weeks, skipping the term's days off (holidays, closures, reading week, study days, from Open Data's important dates); on a make-up day ("Tuesday April 6 follows a Friday schedule") the Friday classes meet and the Tuesday ones don't. With "with the term's dates" ticked, every date the University lists for undergraduates that term is an all-day event: classes begin and end, the add and drop deadlines (WD, WF), fee and refund deadlines, the exam schedule's release, the exam period and grades. Final exams for the courses picked (the lecture's section when the exam names sections) come in as events once Open Data has the term's exam schedule; they're listed under the timetable too, and the term's dates are in a list below the buttons. Everything you pick is in the address (`/calendar/?t=1271&c=CS136,MATH138&off=16`), so the link opens the same timetables.

- **Finding it:** "Timetable" in every page's header, with how many courses are in your plan. Each course page with sections has "+ Add to Winter 2027 timetable" under its title, which adds it without leaving the page (or says it isn't scheduled that term, and offers the term it is in). The home page links it too.
- **Saved in your browser:** one plan per term (`site/calendar/plans.js`, localStorage `uwloo.plans`). A link to someone else's timetable is shown as it is, and only replaces your plan for that term once you change something.

The build writes one file per term, `/calendar/{term}.json`, from the same Open Data sections the course pages show, so seats are as of the last build. The search runs in the browser (`site/calendar/solve.js`, in a worker), so nothing about anyone's plan is sent anywhere. 
## Programs (`/programs/`)

Every program in the current Undergraduate Calendar (505 in 2026–27: majors, specializations, minors, options, diplomas, certificates and degree requirements), read from the same Kuali API as the courses (`scripts/lib/programs.mjs`): `/programs/{catalog}` for the list, `/program/{catalog}/{pid}` for each one. Their requirement lists come in the same "ruleView" HTML as prerequisites, in sections ("Required Courses", "List 1", "1A Term"), so `requisites.mjs` reads them too.

- **A page per program** (`/programs/econ-public-policy-specialization/`, from the calendar's own code for it): who it's open to, graduation requirements, every course list (courses link to their uwloo pages), averages, declaring, admission, co-op, notes, and a link to the official entry. Each rule in words that takes courses by subject and level ("Complete 2.0 additional units of ECON courses at the 200-level or above", "1.0 unit from CS340-CS398, CS440-CS489") lists the courses that fit, under "52 courses fit", with the subject's page, so the course list is one tap away instead of a subject page away. Two links into Pathways: map it out (adds the plan), or pick electives from its courses (opens its panel without adding it). `/programs/` links to the list of every plan there too.
- **Can't be combined with:** from the calendar's Invalid Credential Combinations policy. Its table names programs in its own words ("Data Science major (BCS or BMath)", "Gerontology Minor or Diploma", "Mathematics, Bachelor of"), so uwloo matches each name to programs: 176 of the 178 rows and 606 of the 616 names in 2026–27 (`/programs/combinations/` says so above the table, with what's left and why). A whole degree ("Mathematics, Bachelor of", which can't be combined with the Mathematics Minor) is every major that leads to it and its degree requirements, so a Pure Mathematics major rules the minor out too. Two names the table still uses for programs the calendar has since renamed are read as the new ones, each checked: "Recreation and Sport Business major" is Sport and Recreation Management (Waterloo's page for it still lives at …/programs/recreation-and-sport-business) and "Technical Writing Minor" is the Technical and Professional Writing Minor (the same course list). Its groups are rules too: "Any stand-alone major" (Accounting and Financial Management, Global Business and Digital Arts, Medical Sciences and Sustainability and Financial Management take no other major) is every major but the joint honours plans, "Any other stand-alone major" leaves out the program's own field (Mathematical Economics; the French Teaching Specialization's French majors), "Any other stand-alone Arts major" (Liberal Studies) that faculty's, and "Any other stand-alone or Mathematics Joint plan" (Mathematical Studies) adds Math's joint honours plans; "any second English major" is each English major's others; their pages say so in the calendar's words, and every major they cover lists "Programs that take no other major". What's left: 4 names marked * (no longer offered), "Chemical Physics major" (not in the calendar) and "Honours Arts Co-op" (Arts' co-op stream, not a program), and 5 conditions in words ("Students who have completed a Diploma in HRM or the course requirements for the CHRP designation…", "Any plan similar to one appearing on the student's Laurier academic record transcript"), shown as written on those programs' pages and in their Pathways panels; a name that reads like one program but isn't in that year's calendar (the table still lists "Chemical Physics major" and "Technical Writing Minor") is marked so. It works both ways round, and applies the general rules above the table too, the same way on program pages ("A minor in the same subject as a major", one line per rule) and in Pathways (`planClash` in engine.js): a minor, option, diploma or certificate in the same subject as a major; a minor and a diploma in the same subject; two diplomas in one language; one topic specialization at most in Communication Studies, Economics, History, Mathematical Economics and Theatre and Performance, and no two intensive specializations of one major; no two "and Financial Management" degrees; a BA's two majors both honours; a Bachelor of Architectural Studies student only in the Faculty of Engineering options that say they're for them; a stand-alone BCS with no BMath plan; a BMath joint honours plan with no other faculty's joint honours plan; Data Science with no other Faculty of Mathematics honours plan (but the BBA and BCS double degree); in co-op, a BCS or BMath honours plan with no honours plan that has no co-op (Pathways only, from the grid's work terms); a Bachelor of Medical Sciences student in no Faculty of Science minor or option; and two versions of one major. The one it can't apply is "the same credential that has been renamed" (old names aren't in the current calendar). `/programs/combinations/` has the whole policy with every program linked.
- **Counts toward** on course pages: every program that names the course, and how ("Required", "Choose 2 of 10", "List 1"), then the programs whose rules in words it fits ("2.0 units of ECON courses at the 200-level or above"): 2,780 courses fit some, 6 programs each in the middle.
- **Plans built on a subject** on its page (`/2627/econ/`): the majors, minors, specializations and more that name two or more of its courses or ask for them in words, with what each asks and a link to its courses in Pathways.
- **Yours, everywhere:** Pathways keeps its grid in your browser, and the other pages read it (`site/app.js`). A course's page says "✓ In your degree plan: 3A, Fall 2028", or offers "Plan your degree with ECON 322" (Pathways' card for it, `/pathways/#course=ECON322`); a plan's page says it's one of your plans and ticks the courses it names that your grid has ("✓ marks the 3 courses here in your Pathways grid"); "Counts toward", a subject's plans and `/programs/` tag your plans "yours". Nothing leaves the browser.

The live calendar's programs refresh weekly, like its courses. If Kuali's programs can't be read, the build carries on without these pages.

### Graduate programs (`/programs/grad/`)

The Graduate Calendar's programs come from the same API (the current term's catalog: 265 in Fall 2026), read by the same code (`scripts/lib/gradprograms.mjs` for their pages). A grad program's requirements are mostly prose with course lists inside, per study option: Thesis, Master's Research Paper and Coursework each have their own courses and milestones (`thesisOptionCourseRequirementsRichText`, `…MilestoneRequirements`), and PhDs and diplomas have whole-program ones. Each page has the program's unit, degree, admit terms, full- or part-time, on campus or online, then the degree requirements, each option's courses and milestones, length, research areas, specializations, the accelerated master's details, admission requirements and materials, references, and notes; the other programs in its field, the undergraduate plans in the same field (a master's in Economics links the Economics majors and minor), and the official entry. `/programs/grad/` lists them by faculty and field, with a filter. Graduate course pages' "Counts toward" lists the grad programs that name them, and how ("Master's research paper option: Required"). Pathways has them under Graduate (below).

## Pathways (`/pathways/`)

A whole degree in a grid you type into like a spreadsheet: one row per term from your start term (Study, Co-op or Off; the calendar's co-op sequence charts can set them), up to 7 courses a term. "Pathways" is in every page's header, next to "Timetable".

- **Finding a plan:** the box takes names the way people say them: each word is the start of a word in the name or the initials of a run of words (`math/cpa`, `cpa`, `afm`, `pmath`, `actsci`, `syde`, `c&o`), a subject most of the plan's courses are in (`cs` is Computer Science, `kin` Kinesiology), or a word of its code (`bba`, `farm`). Majors come first, Honours before Joint Honours and general degrees, then shorter names. ↑ and ↓ move through the list and Enter adds one; the chips above it (Majors, Minors, Specializations…) narrow it to one kind, and list every one of that kind with nothing typed.
- **Your plans:** any mix of major, minors, options, specializations, diplomas and degree requirements, with the "can't be combined" rules and "this specialization is for X majors". Each gets a checklist of its requirements, filled from the grid: required courses, "2 of these", unit and course counts from its lists or from subjects at a level ("1.5 units of ECON at the 300-level or above"), totals ("4.0 units of GSJ courses"), and what can't count. Requirements in words it can't check are ticked by hand.
- **Program length and co-op:** every co-op major gets its study/work sequences from the calendar's charts: its own (AFM's six, Software Engineering's streams 8X and 8Y), or the rows of its degree's chart that name it (Mechanical Engineering's streams 8X and 4, Computer Science's four sequences, Math/CPA's six), or the chart's "all other majors" row. Terms lists them under each major with how long each takes ("Sequence 1 · 4⅓ years, 4 work terms"), and switching keeps each study term's courses with its level. Adding a co-op-only major (engineering, AFM, Pharmacy) to an empty grid takes its first sequence; other majors offer theirs. "Your degree" gives the span ("Fall 2026 to Fall 2030: 4⅓ years"). A term-by-term program's usual load (6 or 7 a term in engineering, from its calendar terms) replaces 5 in the load checks.
- **The year you started:** requirements come from the calendar of the year in the Starts box (2021–22 on; a Fall 2020 start uses 2021–22 and says so). The build writes `/pathways/programs-{year}.json` for each past year; past catalogs are cached for good. 2024–25 on come from Kuali. 2021–22 to 2023–24 are read from the archived calendars' program pages (`data/archive-programs/`, fetched once by `scripts/fetch-archive-programs.mjs`) by `scripts/lib/archiveprograms.mjs`: their lists ("One of", "All of", "Three additional courses chosen from", "4.0 units distributed as follows"), lines ("one of ECON 406, ECON 407", "GERON 201/HLTH 201", "four 300-level HIST courses", "Canadian: HIST 253, HIST 254"), engineering's term-by-term curricula (lists or 2021–22's tables) as 1A to 4B terms, elective lists under their heading's count, 2021–22's Mathematics blockquotes, the BA breadth table, and minors stated in a sentence ("four academic course units in Philosophy"). Notes, co-op and admissions are left out; specializations and diplomas on a major's page are plans of their own. A plan that's also in a later calendar takes its name and slug there, so your plans carry over when you change the start year, along with what the old pages don't have: its co-op sequences, systems of study, the degree's total units and the plans it can't be combined with. Courses those years name that aren't in the current calendar come with their titles from that year's calendar. Each plan's "All of its rules" links to its archived page.
- **How many plans:** no faculty caps the number of minors. The limit the grid applies is the calendar's Counting of Courses rule: a course counts toward two academic plans at most, and one required by both a major and its specialization is a single use (degree requirements aren't an academic plan). With three or more plans it says so, and a course that's already counted twice is marked "can't count toward" the next plan, which then needs a course of its own.
- **Fill in courses:** after adding a plan (or any time), one dialog lists what the plans need. Courses required by name go in as they are; choices are buttons ("MATH 135 or MATH 145", "3 of these 12"), asked once when two plans share them; courses described in words go in as placeholders such as `PMATH 4XX` (or are picked from the courses that fit). The preview places everything before you add it: each course in its year (100-level in first year, 300-level in third) or the term a term-by-term program names, after its prerequisites, in a season it has run in, up to 5 a term (or 6, 7). A major's degree requirements come along unless unticked (minus any part that exempts your major, like the BMath's List A for Math/CPA and Mathematical Studies), electives fill up to the degree's total units, and an engineering program's lists (technical electives, ethics) fill its "approved elective" slots. Anything without room is listed, with "allow 6 a term" or "add a term". It fills from the current term on when you started earlier (type in what you've taken). One click undoes it.
- **Optimal plan:** "Optimal plan…" fills in the fewest courses that complete everything you've picked (say Arts and Business with an Economics major, its Public Policy specialization and minors in Sociology and Legal Studies, or a Math major and three minors), with the degree's requirements. Each step takes the course that counts toward the most plans still open (two academic plans at most, as Counting of Courses allows; a major and its specialization share as one use; degree requirements always count), weighed with the prerequisites it would bring: SOC 101 for both minors, or a course cross-listed SOC/LS, before two that count once. Independent studies, honours essays and advanced sections go last; among equals, courses the plans' other courses build on, then lower levels, then ones that run more often. It lists each course it picked and what it counts toward (× picks another instead), places everything after its prerequisites, uses room in earlier terms before adding any, and adds terms after your last (5A, 5B…, up to six more) only when the rest is full at your load (Up to 4–7 a term). Choices it can't settle and courses described in words that nothing in particular fits stay as they are in Fill in courses.
- **Aiming it at a goal:** the Optimal plan takes a goal: a career ("SWE", "law school", "classics professor"), a field ("machine learning theory", "public policy") or a textbook's contents pasted in. `site/pathways/goals.js` turns a career or role into the topics it usually takes (a short list per goal, shown in the dialog so the words can be changed; "non-math student", "professor" and the like drop out), and the course search's index scores every course's fit (`relevance` in `site/search/rank.js`: the same BM25 and LSA nearness as /search, fetched from `/search/` the first time a goal is used). Requirements still come first, but each pick is worth what it counts toward times how well it fits, so a course that fits counts for more than one that only counts twice; then the degree's free electives come from the courses that fit best, with up to two prerequisites each, never another program's own courses (engineering, pharmacy, optometry, architecture) unless your plans name them, until the degree's units are reached. Courses that fit get "fits your goal"; minors, options, specializations, diplomas and certificates whose courses fit it, and that go with your plans (an option for your faculty's majors, a specialization for its majors, not one you can't combine), are offered to add. The goal is kept with your plan.
- **Cross-listed courses:** one course under each of its codes (SOC 327 is LS 327): it meets a requirement that names either code and counts as either subject.
- **Find courses:** for picking electives from the lists programs name. "Find courses…" (or Browse beside any open requirement in a checklist) lists the courses that would still count toward something your plans need: the requirement's own list, the lists a requirement in words names ("from List 1", "the lists below", a section's technical electives), or every course that fits ("2 ECON courses at the 300-level"). Each shows which of your requirements it would meet (ones that count toward two of your plans come first), when it has run (Fall, Winter, Spring in the last four years), and whether its prerequisites are in your plan. Filter by requirement, level, season, search, prerequisites, or "counts toward 2+ of my plans"; Add puts it in its year from this term on, after its prerequisites, in a season it runs. While typing in a cell, courses that would meet something still open come first, with the plan's colour. The fill-in dialog offers the same list courses for "from the lists" requirements instead of only a placeholder.
- **Placeholders:** type `PMATH 4XX`, `ECON XXX` or `elective` into any cell. They hold the slot, count toward requirements in words (an elective toward ones it can't check by subject, like "from the Faculty of Arts"), and never toward a course named by code.
- **Each cell:** red when its prerequisites (or corequisites) aren't in earlier terms, including "level 3A or higher", "Enrolled in…" (checked against your plans) and a minimum grade ("60% in CS 136", once you've entered that grade); amber when it hasn't run in that season in the last four years (from the term history) or can't count toward a plan; antirequisite clashes; dots for the plans it counts toward.
- **The course card:** a course in context, under the grid (below "Type a course code into any cell…"). Select a cell, or tap a course in a plan's checklist on the right (it goes into the grid if it isn't there, and the page comes back up to the grid with its card). Left, its page's story, read from `/econ322/` when the card opens: the calendar's description, the terms it ran (75 since Winter 2002) and how full its lectures were last time (1,481 of 1,920 seats), who taught it (156 people, most often…), what r/uwaterloo says (how many posts, the latest threads), course websites and notes found around the web, the first calendar it's in, and links to its page, its subject's page, a timetable with it, and UW Flow. Then its requisites in words, what's wrong in this cell (or, for a course not in the grid, what it needs first that your grid doesn't have), and its grade. Right, what it counts toward: your plans and how ("Required", "List 1", a rule in words it fits; "not counted toward it now" when other courses already meet it), then every other plan in that year's calendar that names it, by kind (Majors 11, Minors 1…; tap one to open its panel in Still open, with "↑ Back to MATH 135"), and the plans whose rules in words it fits. Then what it leads to: in your grid, for your plans, the rest, with the ones that can't be taken without it underlined (every way through their prerequisites goes through it). "Take it out" leaves it on the card to put back; × closes it. From a course's page, "Plan your degree with ECON 322" opens Pathways on its card (`/pathways/#course=ECON322`), already in the grid or with "Put it in your grid" (in an empty cell you pick first, or wherever it fits: in its year, after its prerequisites, in a term it runs).
- **Grades:** type a grade after the code (`CS 135 85`, `ECON 101 CR`) or in the card. They stay in this browser and are never in a shared link. Below 50, or NCR, WD, WF, DNW, FTC or NMR, a course gives no credit and counts toward nothing (plan a retake; both attempts count in averages); INC and the like count once a final grade is in. Averages follow the calendar's Grades page: weighted by units, anything below 32 counts as 32 (so do DNW, FTC, NMR and WF), CR and WD aren't in them, and PD courses and work-term reports never are. "Your degree" shows your cumulative average and each term's is beside its load. Each plan's minimum averages from the calendar ("cumulative overall 60%", "major average 70%", "a Physics average", "70% in all AVIA, ENVS, GDS and GEOG courses", "60% in two or more of CS 136, CS 138, CS 240–299…", "each term's average") are checked against yours, and a degree's limit on failed units (BMath and BCS: 2.0, not counting COOP and PD). Faculty averages need Open Data's subject-to-faculty map; without it they're marked to check by hand.
- **Work terms:** a co-op work term has two cells, for PD courses, a work-term report, or an online course. Fill in puts PD courses and work-term reports there, one a term. They count toward requirements that name them but not toward a degree's units or averages (no academic credit). An ordinary course on a work term is flagged to check that it's offered online and that your faculty allows it.
- **Switching partway:** pick a term under "from" beside Terms, then a pattern: terms before it stay as they are, the rest follow it. Out of co-op after two work terms ("from Fall 2028", Regular), into co-op ("from Spring 2027", a sequence, picked up after the study terms you've done), or a general degree's six or eight study terms. Clicking a term's kind (Study, Co-op, Off) keeps each kind's courses, so a study term turned into a work term and back has its courses again.
- **Breadth and units by level:** the BA's breadth table (Fine, Performing and Communication Arts; Humanities; Languages and Cultures; Social Sciences, no more than 1.0 unit from one discipline; Transdisciplinary, or any course from another faculty; not ARTS 160 or PD courses) and the BA's and BES's "units at the 200-level or above" (8.0 for most Honours BA majors, 12.5 for Liberal Studies, 15.0 for Planning, by kind of degree) are checklist sections of the degree requirements, applied to your degree type and major. Older BCS breadth and depth rules come with the 2021–24 calendars.
- **Print or PDF:** prints the grid and every checklist, opened, without the controls; choose "Save as PDF" in the print dialog for a file.
- **Loads and length:** each term's courses and units, marked at 6 (overload) and 7+ (heavy); how many courses your plans still need against the degree's total units, whether they fit at 5 a term, and if not how many extra terms or overloads that means.
- **Still open:** every plan, across the whole width under the grid, as long as it needs (the page scrolls, not a box; its bar of tabs stays on top as you go down it). "Still open ↓" under the plan box jumps there, beside what goes with your plans. **All, by field** lays out every plan the way the calendar's lists of academic plans did: by faculty, then field, each field's majors (honours, joint, general; by degree, so Computer Science's BCS and BMath), minor, diplomas and the specializations for its majors in one row (Economics: two majors, a minor, four specializations; AFM: its five; a faculty's options in one row), affiliated colleges marked. **Every plan opens a panel** (any chip, here or in With your plans, and Courses on any row of the lists below): what it still asks for, rule by rule ("All of these", "1 of these", a rule in words), each course with its title, the terms it ran in lately (F W S) and what it needs first ("needs ECON 101"), and a + that puts it in your grid (in its year, after its prerequisites, in a term it runs) without taking the plan: electives toward a minor, or anything else. A rule in words lists the courses that fit it (the first eight, ones that ran lately first; All 52; every ECON course), less the ones a rule above already lists. The panel adds the plan (or removes it), says what it can't go with or who it's for, and links to its page; a program page's "pick electives from its courses" opens it (`/pathways/#show=economics-minor`). **With your plans** comes first: a major's specializations (yours ticked), the options its degree can take (each option lists the degrees it's for: a BASc's thirteen, a BSc in Science's five, a BSc in Health's two), the 30 Faculty of Arts honours majors Arts and Business is taken with ("Complete the requirements for a Faculty of Arts honours major or Honours Liberal Studies", less the invalid combinations), the majors a specialization is for. Who a plan is for comes from what the calendar says when declaring it: Statistics, Actuarial Science and Computational Mathematics minors are for Math students only, the Computer Science minor mostly, Joint Honours Mathematics not for them; three diplomas are only for students outside a degree, and Future Cities is paused. Those are tagged, and struck out (with the calendar's sentence on hover) once your majors rule them out, like plans that can't go with yours ("not with yours", and why on hover and in its panel): the calendar's table and its groups (with Mathematics/CPA, Accounting and Financial Management is out: it "can't be combined with any stand-alone major"), two versions of one major (Economics' BA Honours and Four-Year General), a general BA major with another BA major ("students may combine two honours major academic plans only"), a stand-alone BCS with a BMath plan, and a specialization whose majors are all ruled out. Majors from different faculties aren't struck for that alone: joint honours plans and concurrent degrees cross faculties. **Show** narrows it to one faculty (Mathematics: all its majors, minors and specializations) or a first-year **entry program**: Honours Arts, Honours Arts and Business, Mathematics, Computer Science, Life Sciences, Physical Sciences, Recreation and Leisure Studies, with the majors each leads to (from the admissions site's majors and entry programs; the calendar has majors, not these). Typing one in the plan box ("life sci") offers it too. **Majors**, **Minors** and the other kinds list every plan of that kind, by faculty (yours first) or closest first, with how much of each your grid already covers (counting the whole grid, or through a term you pick) and a link to its page. Find courses links to the minors your grid is closest to, for free electives. The kind chips over the plan box pick the list too. **Graduate** lists every master's, PhD and graduate diploma in the current Graduate Calendar (`/pathways/grad.json`, loaded the first time it's opened) by faculty and field, the ones in your majors' fields first ("Economics · BA Honours: 7 graduate programs in its field", accelerated master's first, since they start in your last undergraduate year); each opens a panel with its study options, each option's courses (with titles) and milestones, admit terms, and its page. `/programs/grad/` opens it (`/pathways/#grad`). The plan box finds them too (`gradHits` in engine.js, matched like plans, initials and course subjects included): "master", "doctor", "phd", "mmath cs", "ma econ", "graduate diploma" put graduate programs first; a subject alone ("economics") lists them after the undergraduate plans, under "Graduate programs"; the Graduate chip beside Majors and Minors lists all of them. Picking one opens its panel, which starts with what it takes to get in (the calendar's admission requirements, a sentence or two) and "Getting there": the undergraduate majors, specializations and minors in its field (`gradLeads`), each a button that adds it to your plans, yours ticked and ones that can't go with yours struck. A graduate program's page links to its panel (`/pathways/#grad=ma-in-economics`). The open panel holds its place on screen while you add courses or plans from it.
- **Other names:** the plan box also finds plans by the names the admissions site, a department or an earlier calendar uses: Geomatics or Geospatial Data Analysis (Geospatial Data Science), Architecture (Architectural Studies), Financial Economics (Economics' Finance specialization), Financial Leadership (AFM's, Enterprise Performance and Risk since 2024–25), Honours Arts and Business, Honours Science.
- **Plan chips:** each plan you've picked is a compact chip (Accounting and Financial Management · BAFM Honours, Financial Markets · Specialization; the calendar's whole name on hover), in one row you swipe along on a phone, so the plan box and the grid stay near the top.
- Saved in your browser; "Copy link" shares the whole plan in the address (without grades); "Copy as a table" pastes into Excel or Google Sheets, grades included, and pastes back in (a column of `STAT 230 81` lines fills down with its grades).

The build writes `/pathways/data.json` (`scripts/lib/pathways.mjs`): every current course (title, units, requisites, which seasons it ran in the last four years) and every program's requirements in the shape `site/pathways/engine.js` reads, plus `/pathways/programs-{year}.json` for each other calendar year. The rules, including filling in and placing courses (`fillItems`, `arrange`), run in the browser, so plans aren't sent anywhere.

## Search (`/search/`)

Courses by what they're about, the way you'd ask Google: `dynamic programming`, `latin`, `fourier series`, `backpropagation`, `photosynthesis`. Each course is a document of its title, its subject's name, its calendar descriptions (this year's and the older ones uwloo has, 2020–21 on, plus Open Data's and the Graduate Calendar archive's for courses no longer offered), the titles of course websites and files found for it, and what r/uwaterloo says about it (up to 12,000 characters a course; threads that mention more than six courses at once are left out).

- **Words:** lowercase, accents off, common words out, Porter's stemmer (`networks` → `network`), and pairs of neighbouring words as terms of their own (`machine learning`), the same at build time and in the browser (`site/search/text.js`). Scores are BM25 with field weights (title 3, subject 1.5, description 1, links 0.8, r/uwaterloo 0.35), scaled by how many of the query's words a course has.
- **What it's about:** latent semantic analysis, a 48-dimension truncated SVD of the term × course matrix (randomized, seeded so each build gives the same files). A query's terms add up to a vector, moved toward the courses that match it best by their words, and courses near it rank too, so `backpropagation` (in one description) also finds CS 480, CS 485 and CS 486. Related ideas are the calendar terms nearest the query (`eigenvalues` → eigenvectors, diagonalization, singular value decomposition), with the more specific ones first. A course code (`cs 341`) links to the course and lists the courses most like it.
- **Results:** courses with the same title share a row (cross-listed ones, or a numbered run like Music Ensemble); the snippet is the description's sentence with the most of your words; links whose titles match are shown; and it says where a course matched. Courses no longer offered and graduate courses rank a little lower. Misspelled words are fixed against the index's own words.

The build writes `search/docs.json` (every course), `search/vec.json` (the LSA vectors, 8-bit), `search/vocab.json`, `search/t/{0-127}.json` (postings by term) and `search/s/{SUBJ}.json` (snippets); `scripts/lib/search.mjs` explains each. Nothing is sent anywhere: a search fetches the few small files its words are in.

## Courses no longer offered

A course that's in none of the current calendars uwloo has (2024–25 on) still gets a page if Waterloo ever listed it: `uwloo.ca/msci452`. It says when it was in the course catalog or the older Graduate Calendars, the terms it ran, its description and requirements as last listed, which of today's courses still mention it (usually as an antirequisite), its r/uwaterloo discussions, and links to its last calendar entry on ucalendar and to the scanned calendars it's in. Today's pages link to it too, greyed out.

A course in the scanned calendars (1963–64 to 1994–95) gets its text from them, version by version, including the instructor when the calendar names one ("Instructor: Dutt, Schuster", common from about 1972 to 1983). Years whose wording matches, give or take OCR misreads, are grouped and shown once, using the year whose text agrees best with the rest, so one bad scan doesn't stand in. A rewrite starts a new version, a title that changes completely is flagged as probably another course under the same number, and gaps between versions are named ("Not in the 1965–66 to 1973–74 calendars"). Each year links to its uwloo page and to its page of the scanned PDF. A course that's only in the scans uses its newest version as its description, with its terms offered, credit weight and requirements. If it was gone before 1994–95, the page leaves out course outlines, UW Flow and WClasses, which don't go back that far. The 1995–96 to 2021–22 calendars aren't read, because ucalendar's robots.txt asks programs to stay out, so a course that ran into those years shows only its scanned versions and a link to ucalendar.

The history comes from UW Open Data: `Courses/{term}` (the catalog each term) and `ClassSchedules/{term}` (what ran), folded into `.cache/opendata/history.json` by `scripts/lib/history.mjs`. Past terms never change, so each is fetched once, newest first, `HISTORY_TERMS_PER_BUILD` (24, eight years) a build. Going back, four empty terms in a row mark where Open Data's records end, and the page says "since at least" that term. Older courses come from the scanned 1963–64 to 1994–95 calendars (seen in at least two years, so an OCR misread doesn't get a page).

## Text for the scanned years

Opening a PDF often means a download, so years with OCR text get real pages instead: `/9495/cs` lists every CS entry from the 1994–95 calendar, with its terms and units, prerequisites linked within that year, a link to its scanned page, and a link to the course today if it still exists. Courses listed under "not offered this year" get an anchor too, and a course the text missed shows a note pointing to its scanned page.

`tools/archive/extract_text.py` makes `data/archive-text/{YYyy}.json`. The PDFs' own text layer is 1990s OCR and too garbled to show, so it re-OCRs the course pages with Tesseract at 300 dpi, which reads these scans almost perfectly, then splits them using `index_pdf.py`'s header detection and the page index. Needs poppler and Tesseract 5; about 3.5 seconds per page per worker, cached in `.cache/ocr/`.

```sh
python tools/archive/extract_text.py path/to/1994-95.pdf    # writes data/archive-text/9495.json
```

All 32 years from 1963–64 to 1994–95 are done: about 62,700 course entries across 1,634 subject pages (28 MB of text, about 50 MB of generated pages). 1969–75 print titles beside their descriptions, so those pages are rebuilt from Tesseract's word positions. About 2% of entries have a missing or run-on title, and descriptions are left blank where the calendar printed a title only (1960s grad courses, seminars, cross-listings).

A link to a course that isn't on the page explains why: it was split into lettered parts that year (`/7778/hist204` → HIST 204A, 204B…), it didn't exist yet (`/8283/math135` → nearest MATH 134B and 140A), or the text missed it, with its scanned page.

## Page numbers for the PDF years

`data/archive/{year}.json` holds page numbers inside that year's scanned calendar, keyed by subject and course:

```json
{ "_courses": 323, "CS": 354, "CS241": 354, "CO": 351, "AMATH": 327 }
```

For a year without text pages, `/8889/cs241` opens the 1988–89 PDF at CS 241's page. A course that isn't listed falls back to its subject, and a subject that isn't listed falls back to `_courses` (where course descriptions begin). Years without a file open at page 1. Page numbers are the PDF's own page count, not the numbers printed on the pages. The build copies these files to `/archive/`, and `404.html` fetches only the year being visited.

All 32 years from 1963–64 to 1994–95 are indexed: about 60,000 subject and course entries in total. `tools/archive/index_pdf.py` builds them, and `tools/archive/README.md` has the per-year counts and notes (layout eras, OCR quality, manual fixes). Letter codes first appear on every course header in 1977–78; earlier years map departments to today's codes (`/6364/math`, `/6364/russ`). `&` is dropped from codes (`C&O` → `co`, `E&CE` → `ece`), and today's codes work for renamed subjects (`amath`, `afm`, `sds`, `gsj`). A test checks every file is present and well-formed before each deploy.

The ucalendar host disallows automated access, so the build never downloads these PDFs; the indexes were made from copies downloaded by hand.

## Local development

Node 20 or newer, no dependencies.

```sh
npm test
UW_API_KEY=your-key npm run build   # or without the key
npm run serve                       # http://localhost:8080
```

`npm run serve` doesn't use `404.html`, so the redirect routes (`/CS135`, `/2324/cs`) only work once deployed.

## Tuning

Environment variables for `scripts/build.mjs`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `UW_API_KEY` | unset | Enables Open Data |
| `TERMS_BACK` / `TERMS_AHEAD` | 6 / 2 | Terms shown in the strip around the current one |
| `SECTION_TERMS` | 2 | How many terms (from the current one) get a sections table |
| `HISTORY_TERMS_BACK` | 21 | How far back `courses.csv` looks for the last term a course ran |
| `HISTORY_TERMS_PER_BUILD` | 24 | Past terms of Open Data added to the course history each build |
| `KUALI_MAX_AGE_DAYS` | 7 | How often the live calendar's course details are refetched |
| `KUALI_CONCURRENCY` / `OPENDATA_CONCURRENCY` | 6 / 3 | Parallel requests; keep these low |
| `UWFLOW` / `UWFLOW_MAX_AGE_DAYS` | on / 7 | `off` leaves out UW Flow reviews; how often they're refetched |

## Files

```
.github/workflows/deploy.yml   daily build + Pages deploy
scripts/setup.mjs              Pages settings + Cloudflare DNS, run before each build
scripts/build.mjs              fetch, join, render, write dist/
scripts/lib/kuali.mjs          calendar years and courses
scripts/lib/opendata.mjs       offerings, faculty, sections
scripts/lib/requisites.mjs     Kuali requisite HTML → plain-language tree
scripts/lib/render.mjs         page templates
scripts/lib/terms.mjs          term codes (1269) and year codes (2627)
scripts/test.mjs               unit tests, run before every build
tools/reddit/index_dump.py     r/uwaterloo dump -> data/reddit/{SUBJ}.json
data/reddit/removed.txt        quotes taken down on request
scripts/lib/uwflow.mjs         UW Flow ratings and comments, and their section on course pages
data/uwflow/removed.txt        UW Flow comments taken down on request
site/reddit.js                 discussion cards, shared by the build and the browser
data/archive/{year}.json       page numbers inside the 1963–64 to 1994–95 PDFs
scripts/lib/history.mjs        every course Open Data's catalog has listed, and when each ran
scripts/lib/retired.mjs        pages for courses no longer offered (/msci452/)
scripts/schedules.mjs          reads past class schedules from WClasses into data/schedules/
scripts/term-archive.mjs       keeps each term's sections from Open Data in data/terms-od/ (weekly)
scripts/grad-archive.mjs       reads the older calendars uwloo hosts (.github/workflows/grad-archive.yml)
scripts/lib/gradarchive.mjs    where they are, how a course page is read and stored, their pages (/1109/co/)
data/grad-archive/             those calendars, a report of each read, and sample pages
scripts/lib/ugarchive.mjs      the 2020–21 to 2023–24 undergraduate years uwloo hosts, and their pages (/2324/cs/)
data/ug-archive/               those years, read by the same job
scripts/lib/resources.mjs      course resources: catalogue, course-page section, PDF pages, release files
tools/resources/               intake.py (zip of PDFs → catalogue entries) and how to use it
data/resources/                the resources catalogue, and each hosted PDF's text
site/viewer.js                 the PDF viewer on resource pages (PDF.js, in site/vendor/)
scripts/find-links.mjs         the weekly link finder (.github/workflows/find-links.yml)
scripts/lib/links.mjs          its rules: course codes in pages and addresses, robots.txt, what's skipped
tools/links/                   reddit_links.py (r/uwaterloo dump → data/links/seeds/) and how the finder works
data/links/                    where the finder looks, what it found, and what's been removed
scripts/lib/planner.mjs        the timetable planner's page and its per-term data files
scripts/lib/programs.mjs       programs: reading them, combinations, their pages (with the courses that fit their rules in words), "Counts toward"
scripts/lib/gradprograms.mjs   graduate programs: study options, their pages and index (/programs/grad/), Pathways' grad.json
scripts/lib/pathways.mjs       Pathways' data file and page; site/pathways/ is the app (engine.js, app.js)
scripts/lib/archiveprograms.mjs  the 2021–24 calendars' program pages (data/archive-programs/) as Pathways plans
scripts/lib/search.mjs         the search index (BM25 postings, LSA vectors, snippets) and page; site/search/ is the app
scripts/probe-archive.mjs      one-off: maps academic-calendar-archive's 2021–24 program pages and samples Open Data dates and exams
scripts/fetch-archive-programs.mjs  one-off: the 2021–24 calendars' program pages into data/archive-programs/ (for older Pathways start years)
site/calendar/                 the planner in the browser: solve.js (the search), planner.js (the page), ics.js, plans.js (saved plans)
site/                          CSS, client JS, the URL router used by 404.html
```

Faculty colours are approximations of Waterloo's faculty colours, adjusted for contrast. This site is unofficial; the Undergraduate Calendar is the authority on requirements.
