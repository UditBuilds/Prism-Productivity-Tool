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
 * Which search hits to try fetching: fetchable https links only, no PDFs or
 * video pages (this PR reads web pages), one per site so a lesson is not
 * three pages of the same tutorial, in the search tool's order.
 */
export function pickCandidates(hits: SearchHit[], max: number): SearchHit[] {
  const out: SearchHit[] = [];
  const hosts = new Set<string>();
  for (const hit of hits) {
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
