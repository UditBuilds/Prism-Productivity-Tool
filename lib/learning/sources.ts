import { TUTORIAL_LABEL } from "@/lib/learning/constants";
import { checkFetchUrl } from "@/lib/learning/net-guard";

/**
 * Where a lesson's source may come from, as code.
 *
 * The source rule (decision 3): a link is stored only if Groq's search tool
 * returned it or the server fetched it. Never a URL the model typed. In the
 * Part 1 probe the model's own answer cited Real Python and W3Schools pages
 * with the note "search result not opened but typical" — pages the tool
 * never returned. So search URLs come from `executed_tools[].search_results`,
 * lesson sources are the pages safe-fetch actually loaded, and the writer
 * never sees a URL at all.
 *
 * The documentation site first (Udit, 2026-10-10): the planner names the
 * topic's official documentation site once (learning_topics.docs_site), every
 * step searches inside it first ("site:docs.python.org …", which Groq's
 * browser_search honours: 10 of 10 results on that host, measured
 * 2026-10-10), and the open web is searched only when that finds nothing. A
 * source on any other host is shown as a tutorial site.
 */

export interface SearchHit {
  url: string;
  title: string;
}

export interface SearchHarvest {
  hits: SearchHit[];
  /** browser_search calls the model made. */
  searches: number;
  /** Pages the model opened despite being told not to — each one is expensive. */
  pagesOpened: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * Pull search results out of a chat completion's `message.executed_tools`.
 * Shape measured 2026-10-09: one entry per tool turn, `type` "browser_search"
 * for a search (results in `search_results.results[]`) and "browser.open" for
 * an opened page. Anything that does not look like that is ignored rather
 * than guessed at.
 */
export function harvestSearchResults(executedTools: unknown): SearchHarvest {
  const out: SearchHarvest = { hits: [], searches: 0, pagesOpened: 0 };
  if (!Array.isArray(executedTools)) return out;
  const seen = new Set<string>();
  for (const raw of executedTools) {
    const tool = asRecord(raw);
    if (!tool) continue;
    const type = typeof tool.type === "string" ? tool.type : "";
    if (type !== "browser_search") {
      if (type.startsWith("browser")) out.pagesOpened += 1;
      continue;
    }
    out.searches += 1;
    const sr = asRecord(tool.search_results);
    const results = Array.isArray(sr?.results) ? sr.results : [];
    for (const r of results) {
      const rec = asRecord(r);
      const url = typeof rec?.url === "string" ? rec.url.trim() : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title = typeof rec?.title === "string" ? rec.title.trim() : "";
      out.hits.push({ url, title });
    }
  }
  return out;
}

/** The query that searches inside the documentation site. */
export function siteQuery(docsSite: string, query: string): string {
  return `site:${docsSite} ${query}`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when the page is on the topic's documentation site. */
export function onDocsSite(url: string, docsSite: string | null): boolean {
  return docsSite !== null && hostOf(url) === docsSite;
}

/** The label under a source: none on the official documentation site, the tutorial label anywhere else. */
export function sourceLabel(url: string, docsSite: string | null): string | null {
  return onDocsSite(url, docsSite) ? null : TUTORIAL_LABEL;
}

const SKIP_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "instagram.com", "facebook.com", "x.com", "twitter.com"];

/** A fetchable web page: https, a public host, not a video site, not a PDF. */
function fetchable(url: string): URL | null {
  const verdict = checkFetchUrl(url);
  if (!verdict.ok) return null;
  const host = verdict.url.hostname.replace(/^www\./, "").toLowerCase();
  if (SKIP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  if (/\.pdf$/i.test(verdict.url.pathname)) return null;
  return verdict.url;
}

/** A path segment that names a version: "3", "3.11", "v2", "stable", "latest". */
const VERSION_SEGMENT = /^(?:v?\d+(?:\.\d+)*|stable|latest|current|dev)$/i;

function versionRank(segment: string | null): number {
  if (segment === null || /^(?:stable|latest|current)$/i.test(segment)) return 0;
  if (/^v?\d+$/i.test(segment)) return 1; // "3": the current major version
  if (/^dev$/i.test(segment)) return 3;
  return 2; // "3.11", "3.0": one release, maybe an old one
}

/**
 * Pages to try on the documentation site, best first. NOT one per host — the
 * whole list is one host (Udit, 2026-10-10). One per PAGE instead: the probe
 * for "site:docs.python.org" returned the same tutorial page for Python 3,
 * 3.0, 3.4, 3.6, 3.9, 3.10 and 3.11, and trying the next one would have
 * meant a lesson from the Python 3.0 docs. So the copies of a page collapse
 * into one, the current version ("3", "stable", or no version) preferred.
 */
export function pickDocsCandidates(hits: SearchHit[], docsSite: string, max: number): SearchHit[] {
  const pages = new Map<string, { hit: SearchHit; rank: number; order: number }>();
  hits.forEach((hit, order) => {
    const url = fetchable(hit.url);
    if (!url || hostOf(url.toString()) !== docsSite) return;
    const segments = url.pathname.split("/").filter(Boolean);
    const at = segments.findIndex((s) => VERSION_SEGMENT.test(s));
    const version = at === -1 ? null : segments[at];
    const key = (at === -1 ? segments : segments.filter((_, i) => i !== at)).join("/");
    const rank = versionRank(version);
    const prev = pages.get(key);
    if (!prev) pages.set(key, { hit, rank, order });
    else if (rank < prev.rank) pages.set(key, { hit, rank, order: prev.order });
  });
  return Array.from(pages.values())
    .sort((a, b) => a.order - b.order)
    .slice(0, max)
    .map((p) => p.hit);
}

/**
 * Pages to try from the open web: fetchable links only, one per site so a
 * lesson is not three pages of the same tutorial, in the search tool's
 * order, minus pages already tried.
 */
export function pickCandidates(hits: SearchHit[], max: number, skip: Set<string> = new Set()): SearchHit[] {
  const out: SearchHit[] = [];
  const hosts = new Set<string>();
  for (const hit of hits) {
    if (skip.has(hit.url)) continue;
    const url = fetchable(hit.url);
    if (!url) continue;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (hosts.has(host)) continue;
    hosts.add(host);
    out.push(hit);
    if (out.length >= max) break;
  }
  return out;
}

const MARKETING = [
  /\btrusted by\b/i,
  /\b(?:book|request|get|schedule) a demo\b/i,
  /\b(?:contact|talk to) (?:sales|an expert)\b/i,
  /\bfree trial\b/i,
  /\bpricing\b/i,
  /\b(?:customer stories|case studies)\b/i,
  /^(?:start building|get started(?: for free)?|sign up(?: for free)?|try (?:it )?(?:for )?free|enroll for free)$/im,
];

/** A paragraph that is one quotation, followed by a short line naming a job: a testimonial. */
const TESTIMONIAL = /\n\n[“"][^\n]{40,}[”"]\n\n[^\n]{2,60}\n\n[^\n]{0,60}\b(?:CEO|CTO|CIO|COO|VP|Head of|Director|Founder|Officer|Manager|Engineer|Lead|Architect|SWE|Principal)\b/;

/**
 * Decision 3: a vendor's landing page, not a page that teaches. Read from
 * the page's own text: the site's front page, a customer testimonial, or two
 * kinds of sales wording ("Trusted by", "Book a demo", a bare "Start
 * building" button line). Measured 2026-10-10 on langchain.com/langgraph:
 * "Trusted by", "Start building", "Enroll for free" and three testimonials.
 * Only open-web pages are checked: the documentation site is the source the
 * planner chose.
 */
export function isLandingPage(url: string, text: string): boolean {
  try {
    if (new URL(url).pathname.replace(/\/+$/, "") === "") return true;
  } catch {
    return false;
  }
  if (TESTIMONIAL.test(`\n\n${text}`)) return true;
  return MARKETING.filter((re) => re.test(text)).length >= 2;
}

/**
 * Remembers every URL the pipeline is allowed to store, and refuses the rest.
 * The job adds tool-returned URLs and the final URL of every page it fetched;
 * isStorable() is the last gate before a source row is written.
 */
export class SourceProvenance {
  private readonly fromTool = new Set<string>();
  private readonly fromFetch = new Set<string>();

  addToolUrl(url: string): void {
    this.fromTool.add(url);
  }

  addFetchedUrl(url: string): void {
    this.fromFetch.add(url);
  }

  isStorable(url: string): boolean {
    if (!checkFetchUrl(url).ok) return false;
    return this.fromTool.has(url) || this.fromFetch.has(url);
  }
}

/**
 * A web address in text: a scheme, "www.", or a host with a common ending
 * ("python.org/downloads" — measured 2026-10-10, a passage the old link rule
 * missed). Module names such as np.array or os.path do not end that way.
 * The lesson holds no links: sources are listed under it, from fetched rows.
 */
const WEB_ADDRESS_SOURCE = String.raw`\bhttps?:\/\/[^\s<>"'\`)\]]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"'\`)\]]*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ai|edu|gov)\b(?:\/[^\s<>"'\`)\]]*)?`;

export function hasWebAddress(s: string): boolean {
  return new RegExp(WEB_ADDRESS_SOURCE, "i").test(s);
}

/** The text with every web address taken out: what the writer may see of the step. */
export function stripWebAddresses(s: string): string {
  return s.replace(new RegExp(WEB_ADDRESS_SOURCE, "gi"), " ").replace(/\s+/g, " ").trim();
}
