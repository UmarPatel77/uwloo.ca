// The 2021–22 to 2023–24 Undergraduate Calendars' program pages (academic-calendar-archive.uwaterloo.ca, read by
// scripts/fetch-archive-programs.mjs into data/archive-programs/), as plans for Pathways' older start years.

/** A page's own part: from its first heading to the Registrar's address at the foot, without scripts. */
export function mainPart(html) {
  const clean = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '');
  const start = clean.search(/<h1\b/i);
  const end = clean.search(/Office of the Registrar\s*(<[^>]+>\s*)*University of Waterloo/i);
  return clean.slice(start >= 0 ? start : 0, end > start ? end : undefined).replace(/\s+/g, ' ').trim();
}
