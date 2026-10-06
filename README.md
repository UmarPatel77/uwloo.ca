# uwloo.ca

Waterloo course pages at short URLs. A GitHub Action pulls the university's own data once a day and publishes a static site to GitHub Pages.

## URLs

| You type | You get |
| --- | --- |
| `uwloo.ca/cs135` (also `/CS135`, `/cs-135`, `/cs/135`) | Course page: prerequisites, corequisites, antirequisites, what it leads to, the last 7 terms it ran, this term's and next term's sections with seats, and links out |
| `uwloo.ca/2627/cs` | Every CS course in the 2026–27 calendar on one page, ucalendar style |
| `uwloo.ca/2627/cs135` | Same page, scrolled to CS 135 |
| `uwloo.ca/cs` | The current calendar year's CS page |
| `uwloo.ca/2627` | All subjects in the 2026–27 calendar |
| `uwloo.ca/2324/cs` and any year back to `5758` | Redirects to `ucalendar.uwaterloo.ca/2324/COURSE/course-CS.html` |
| `uwloo.ca/1269/cs135` | Redirects to `acal.fast.uwaterloo.ca/course/1269/CS/135` |

Calendar years 2024–25 onward come from Kuali and are rebuilt here. New years appear automatically when Waterloo publishes them.

## Where the data comes from

| Source | Used for | Key |
| --- | --- | --- |
| Kuali catalog API (`uwaterloocm.kuali.co/api/v1/catalog`), the JSON behind `uwaterloo.ca/academic-calendar/undergraduate-studies/catalog` | Every course, description, requisite, note, and cross-listing, for each calendar year | None |
| UW Open Data API v3 (`openapi.data.uwaterloo.ca/v3`) | Which terms a course ran in, faculty, sections and seats for the current and next term | Free, optional |

Pages link out to the Schedule of Classes, Quest Class Search, acal, the official calendar entry, and UW Flow reviews. Those sites are linked, not scraped: the Schedule of Classes disallows automated access and is being retired, and Quest needs a session.

Open Data withholds instructor names and rooms and can trail Quest by up to two days, so the sections table says so and links to the Schedule of Classes for the live view.

## Setup

1. **Create the repo.** Push this folder to a new GitHub repo (any name, e.g. `uwloo.ca`) on the `main` branch.
2. **Turn on Pages.** Settings → Pages → Source: **GitHub Actions**.
3. **Add the Open Data key (optional but recommended).** Keys are requested through the API itself:

   ```sh
   curl -X POST https://openapi.data.uwaterloo.ca/v3/account/register \
     -d 'email=YOU@uwaterloo.ca&project=uwloo.ca&uri=https%3A%2F%2Fuwloo.ca'
   ```

   An email arrives with the key and a confirmation code; activate it with `POST /v3/account/confirm` (email + code), per the [getting started guide](https://github.com/uwaterloo/OpenData/wiki/Home---Getting-Started). Then Settings → Secrets and variables → Actions → New repository secret, name `UW_API_KEY`. Without a key the site still builds; course pages just skip the term strip and sections.
4. **Run it.** Actions → "Build and deploy uwloo.ca" → Run workflow. The first run fetches every course in every Kuali year (several thousand requests, roughly 15–30 minutes). Later runs reuse the cache and take a few minutes.
5. **Verify the domain.** Your GitHub profile → Settings → Pages → Add a domain → `uwloo.ca`, then add the TXT record it shows. This stops anyone else from claiming the domain on GitHub.
6. **Point DNS at GitHub** (at your registrar, for `uwloo.ca`):

   | Type | Name | Value |
   | --- | --- | --- |
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | AAAA | @ | 2606:50c0:8000::153 |
   | AAAA | @ | 2606:50c0:8001::153 |
   | AAAA | @ | 2606:50c0:8002::153 |
   | AAAA | @ | 2606:50c0:8003::153 |
   | CNAME | www | `YOUR-GITHUB-USERNAME.github.io` |

7. **Set the custom domain.** Settings → Pages → Custom domain: `uwloo.ca` → Save. Once the DNS check passes, tick **Enforce HTTPS**. GitHub redirects `www.uwloo.ca` to `uwloo.ca` on its own.

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
| `KUALI_MAX_AGE_DAYS` | 7 | How often the live calendar's course details are refetched |
| `KUALI_CONCURRENCY` / `OPENDATA_CONCURRENCY` | 6 / 3 | Parallel requests; keep these low |

## Files

```
.github/workflows/deploy.yml   daily build + Pages deploy
scripts/build.mjs              fetch, join, render, write dist/
scripts/lib/kuali.mjs          calendar years and courses
scripts/lib/opendata.mjs       offerings, faculty, sections
scripts/lib/requisites.mjs     Kuali requisite HTML → plain-language tree
scripts/lib/render.mjs         page templates
scripts/lib/terms.mjs          term codes (1269) and year codes (2627)
scripts/test.mjs               unit tests, run before every build
site/                          CSS, client JS, the URL router used by 404.html
```

Faculty colours are approximations of Waterloo's faculty colours, adjusted for contrast. This site is unofficial; the Undergraduate Calendar is the authority on requirements.
