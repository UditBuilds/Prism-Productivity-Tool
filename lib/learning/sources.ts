import { checkFetchUrl } from "@/lib/learning/net-guard";

/**
 * The source rule (decision 3), as code: a link is stored only if Groq's
 * search tool returned it or the server fetched it. Never a URL the model
 * typed.
 *
 * Why this has to be mechanical: in the Part 1 probe the model's own answer
 * cited Real Python and W3Schools pages with the note "search result not
 * opened but typical" — pages the tool never returned. The model's prose is
 * not evidence of anything, so the pipeline never reads a URL out of it:
 * search URLs come from `executed_tools[].search_results`, lesson sources are
 * the pages safe-fetch actually loaded, and the writer refers to sources only
 * by number.
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

const SKIP_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "instagram.com", "facebook.com", "x.com", "twitter.com"];

/**
 * What counts as documentation (Udit's rule, 2026-10-10): a docs.* host, or a
 * /docs/ path segment. Nothing else. The first version also took /tutorials/,
 * /learn-, /handbook and learn.* hosts, and on the first live lesson all five
 * candidates read as "documentation" — a tutorial site's mistakes ("the
 * keyword print") reached the lesson that way.
 */
const DOCS_HOST = /^docs\./i;
const DOCS_PATH = /\/docs(?:\/|$)/i;

export function isDocsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return DOCS_HOST.test(u.hostname.replace(/^www\./, "")) || DOCS_PATH.test(u.pathname);
  } catch {
    return false;
  }
}
/**
 * Which search hits to try fetching: fetchable https links only, no PDFs or
 * video pages (this PR reads web pages), one per site so a lesson is not
 * three pages of the same tutorial. Documentation pages go first; the rest
 * keep the search tool's order.
 */
export function pickCandidates(hits: SearchHit[], max: number): SearchHit[] {
  const out: SearchHit[] = [];
  const hosts = new Set<string>();
  const ranked = [...hits.filter((h) => isDocsUrl(h.url)), ...hits.filter((h) => !isDocsUrl(h.url))];
  for (const hit of ranked) {
    const verdict = checkFetchUrl(hit.url);
    if (!verdict.ok) continue;
    const host = verdict.url.hostname.replace(/^www\./, "").toLowerCase();
    if (SKIP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    if (/\.pdf$/i.test(verdict.url.pathname)) continue;
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
 */
export function isLandingPage(url: string, text: string): boolean {
  try {
    if (new URL(url).pathname.replace(/\/+$/, "") === "" && !isDocsUrl(url)) return true;
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

/** Any link-like text. Lesson prose must contain none: sources are numbered. */
export const URL_IN_TEXT = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/i;
