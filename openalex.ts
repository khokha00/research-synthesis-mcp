import type {
  OpenAlexResponse,
  OpenAlexWork,
  PaperSummary,
  SearchResult,
} from "./types.js";

// ── Config ────────────────────────────────────────────────────────────────────

const OPENALEX_BASE = "https://api.openalex.org";

// Add your email for the "polite pool" — faster rate limits, no key needed.
// Falls back gracefully if not set.
const MAILTO = process.env.OPENALEX_EMAIL ?? "";

// ── Abstract reconstruction ───────────────────────────────────────────────────
// OpenAlex stores abstracts as an inverted index: { word: [pos1, pos2, ...] }
// We reassemble them into readable text.

function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null
): string | null {
  if (!invertedIndex) return null;

  const wordMap: Map<number, string> = new Map();
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      wordMap.set(pos, word);
    }
  }

  const sorted = [...wordMap.entries()].sort(([a], [b]) => a - b);
  return sorted.map(([, word]) => word).join(" ");
}

// ── Shape a raw OpenAlex work into our clean PaperSummary ────────────────────

function shapePaper(work: OpenAlexWork): PaperSummary {
  const authors = work.authorships
    .slice(0, 5) // cap at 5 — "et al." applies beyond
    .map((a) => a.author.display_name);

  const pdfUrl =
    work.open_access.oa_url ??
    work.primary_location?.pdf_url ??
    null;

  const landingUrl =
    work.primary_location?.landing_page_url ?? null;

  const concepts = work.concepts
    .filter((c) => c.score > 0.4) // only high-confidence concepts
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((c) => c.display_name);

  return {
    id: work.id,
    title: work.display_name ?? work.title,
    authors,
    year: work.publication_year,
    doi: work.doi,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    citedByCount: work.cited_by_count,
    isOpenAccess: work.open_access.is_oa,
    oaStatus: work.open_access.oa_status,
    pdfUrl,
    landingUrl,
    source: work.primary_location?.source?.display_name ?? null,
    concepts,
  };
}

// ── Query builder ─────────────────────────────────────────────────────────────

interface SearchOptions {
  /** Max results to return to the caller (after fetching). Default 5. */
  limit?: number;
  /** Restrict to open-access papers only. Default true. */
  openAccessOnly?: boolean;
  /** Filter by publication year (e.g. 2020 for "from 2020 onwards"). */
  fromYear?: number;
  /** Sort: "cited_by_count:desc" | "publication_date:desc". Default: relevance. */
  sortBy?: "citations" | "recent" | "relevance";
}

function buildUrl(query: string, options: SearchOptions): string {
  const params = new URLSearchParams();

  params.set("search", query);
  params.set("per_page", "10"); // always fetch 10, slice to limit after

  // Filters
  const filters: string[] = [];
  if (options.openAccessOnly !== false) filters.push("is_oa:true");
  if (options.fromYear) filters.push(`publication_year:>${options.fromYear - 1}`);
  if (filters.length) params.set("filter", filters.join(","));

  // Sort
  if (options.sortBy === "citations") params.set("sort", "cited_by_count:desc");
  else if (options.sortBy === "recent") params.set("sort", "publication_date:desc");
  // "relevance" is the default — don't set sort param

  // Abstract fields we need (reduces payload size)
  params.set(
    "select",
    [
      "id",
      "doi",
      "display_name",
      "title",
      "publication_year",
      "type",
      "open_access",
      "authorships",
      "cited_by_count",
      "abstract_inverted_index",
      "concepts",
      "primary_location",
      "biblio",
    ].join(",")
  );

  if (MAILTO) params.set("mailto", MAILTO);

  return `${OPENALEX_BASE}/works?${params.toString()}`;
}

// ── Main exported function ────────────────────────────────────────────────────

export async function searchPapers(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const limit = options.limit ?? 5;
  const url = buildUrl(query, options);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": `ResearchSynthesisMCP/1.0 (${MAILTO || "anonymous"})`,
      },
    });
  } catch (err) {
    throw new Error(
      `Network error reaching OpenAlex: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OpenAlex API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as OpenAlexResponse;

  const papers = data.results.slice(0, limit).map(shapePaper);

  return {
    query,
    totalFound: data.meta.count,
    papers,
    fetchedAt: new Date().toISOString(),
  };
}