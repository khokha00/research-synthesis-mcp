// ── OpenAlex API response shapes ─────────────────────────────────────────────

export interface OpenAlexWork {
  id: string;
  doi: string | null;
  title: string;
  display_name: string;
  publication_year: number | null;
  publication_date: string | null;
  type: string;

  // Open-access info
  open_access: {
    is_oa: boolean;
    oa_status: "gold" | "green" | "bronze" | "hybrid" | "closed";
    oa_url: string | null;
  };

  // Authorship
  authorships: Array<{
    author: {
      id: string;
      display_name: string;
      orcid: string | null;
    };
    institutions: Array<{
      id: string;
      display_name: string;
      country_code: string;
    }>;
  }>;

  // Citation counts
  cited_by_count: number;

  // Abstract (inverted index format from OpenAlex)
  abstract_inverted_index: Record<string, number[]> | null;

  // Concepts / topics
  concepts: Array<{
    id: string;
    display_name: string;
    level: number;
    score: number;
  }>;

  // Primary location (where to get the paper)
  primary_location: {
    source: {
      id: string;
      display_name: string;
      type: string;
    } | null;
    pdf_url: string | null;
    landing_page_url: string | null;
    is_oa: boolean;
  } | null;

  // Biblio
  biblio: {
    volume: string | null;
    issue: string | null;
    first_page: string | null;
    last_page: string | null;
  };
}

export interface OpenAlexResponse {
  meta: {
    count: number;
    db_response_time_ms: number;
    page: number;
    per_page: number;
  };
  results: OpenAlexWork[];
}

// ── Cleaned / output shapes ───────────────────────────────────────────────────

export interface PaperSummary {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  abstract: string | null;
  citedByCount: number;
  isOpenAccess: boolean;
  oaStatus: string;
  pdfUrl: string | null;
  landingUrl: string | null;
  concepts: string[];
  source: string | null;
}

export interface SearchResult {
  query: string;
  totalFound: number;
  papers: PaperSummary[];
  fetchedAt: string;
}