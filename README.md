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
| `uwloo.ca/cs` | The current calendar year's CS page |
| `uwloo.ca/2627` | All subjects in the 2026–27 calendar |
| `uwloo.ca/2324/cs`, any year from `9596` to `2324` | Redirects to `ucalendar.uwaterloo.ca/2324/COURSE/course-CS.html` |
| `uwloo.ca/8889/cs`, any year from `6364` to `9495` | Redirects to that year's scanned calendar, `ucalendar.uwaterloo.ca/6394/1988-89.pdf`, at the CS page if `data/archive/8889.json` has it |
| `uwloo.ca/6263/…` and earlier | Not online; says the archive starts at 1963–64 |
| `uwloo.ca/courses.csv` | Every course: title, level, whether it's in the current calendars, the last term it ran (looking back 7 years), and its outline.uwaterloo.ca search link. Opens in Excel |
| `uwloo.ca/1269/cs135` | Redirects to `acal.fast.uwaterloo.ca/course/1269/CS/135` whenever uwloo has no page for it (undergrad codes, and terms before Spring 2024) |

Every entry on a calendar page also links to its official entry and to acal for that year or term (the fall term for an undergrad year). Term codes and year codes can't be confused until Spring 2041 (`1415`, which is also 2014–15).

Undergraduate calendars from 2024–25 and graduate calendars from Spring 2024 come from Kuali and are rebuilt here. New years and terms appear automatically when Waterloo publishes them. Graduate calendars before Spring 2024 aren't included yet.

## How I intially thought about approaching it
uwloo./[2627≥YYyy≥5758]/[subj] uses new course index uwaterloo.ca/academic-calendar/[(under)graduate]-studies/catalog#/courses/ to replicate ucalendar.uwaterloo.ca/[≤2324]/COURSE/course-[SUBJ].html, and uwloo./[subj][ID][suffix] is an updated version of uwflow.com’s outdated requisites and pathways vs acal.fast.uwaterloo.ca/course/[current or 4#’s:Century less 20 + /YY/ + 1stMofTerm]/[subj]/[ID#] and quest.pecs.uW/psc/PB/ACADEMIC/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL#:~:text=Class,Search and https://classes.uwaterloo.ca/cgi-bin/cgiwrap/infocour/salook.pl?level=under&sess=[4#’s]&subject=[subj]

## Where the data comes from (All AI gen text below) 

| Source | Used for | Key |
| --- | --- | --- |
| Kuali catalog API (`uwaterloocm.kuali.co/api/v1/catalog`), the JSON behind `uwaterloo.ca/academic-calendar/undergraduate-studies/catalog` | Every undergraduate and graduate course, description, requisite, note, and cross-listing, for each calendar year (undergrad) and term (grad) | None |
| UW Open Data API v3 (`openapi.data.uwaterloo.ca/v3`) | Which terms a course ran in, faculty, sections and seats for the current and next term | Free, optional |

Pages link out to the Schedule of Classes, Quest Class Search, acal, the official calendar entry, course outlines on outline.uwaterloo.ca, and UW Flow reviews. Those sites are linked, not scraped: the Schedule of Classes disallows automated access and is being retired, Quest needs a session, and outline.uwaterloo.ca needs a UW login and disallows automated access.

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

## Page numbers for the PDF years

`data/archive/{year}.json` holds page numbers inside that year's scanned calendar, keyed by subject and course:

```json
{ "_courses": 323, "CS": 354, "CS241": 354, "CO": 351, "AMATH": 327 }
```

`/9495/cs241` opens the 1994–95 PDF at page 354. A course that isn't listed falls back to its subject, and a subject that isn't listed falls back to `_courses` (where course descriptions begin). Years without a file open at page 1. Page numbers are the PDF's own page count, not the numbers printed on the pages. The build copies these files to `/archive/`, and `404.html` fetches only the year being visited.

Indexed so far:

| Year | Subjects | Courses | Notes |
| --- | --- | --- | --- |
| 1963–64 | 25 departments | 349 | No letter codes yet; departments are mapped to today's codes (`/6364/math` → Mathematics, `/6364/russ` → Russian). Course numbers come from single-subject departments. |
| 1994–95 | 74 | 1,746 | Codes as printed, with `&` dropped (`C&O` → `co`, `E&CE` → `ece`), plus today's codes for renamed subjects (`amath`, `afm`, `sds`, `gsj`). |

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
| `KUALI_MAX_AGE_DAYS` | 7 | How often the live calendar's course details are refetched |
| `KUALI_CONCURRENCY` / `OPENDATA_CONCURRENCY` | 6 / 3 | Parallel requests; keep these low |

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
data/archive/{year}.json       page numbers inside the 1963–64 to 1994–95 PDFs
site/                          CSS, client JS, the URL router used by 404.html
```

Faculty colours are approximations of Waterloo's faculty colours, adjusted for contrast. This site is unofficial; the Undergraduate Calendar is the authority on requirements.
