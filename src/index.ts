import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchPapers } from "./openalex.js";
import type { PaperSummary } from "./types.js";

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "research-synthesis-mcp",
  version: "1.0.0",
});

// ── Formatters ────────────────────────────────────────────────────────────────

function formatPaper(p: PaperSummary, index: number): string {
  const lines: string[] = [];

  lines.push(`## [${index + 1}] ${p.title}`);
  lines.push(`**Authors:** ${p.authors.join(", ") || "Unknown"}${p.authors.length === 5 ? " et al." : ""}`);
  lines.push(`**Year:** ${p.year ?? "N/A"} | **Citations:** ${p.citedByCount}`);
  lines.push(`**Open Access:** ${p.isOpenAccess ? `✅ ${p.oaStatus.toUpperCase()}` : "❌ Closed"}`);

  if (p.source) lines.push(`**Published in:** ${p.source}`);
  if (p.doi) lines.push(`**DOI:** ${p.doi}`);
  if (p.pdfUrl) lines.push(`**PDF:** ${p.pdfUrl}`);
  if (p.landingUrl && !p.pdfUrl) lines.push(`**Landing page:** ${p.landingUrl}`);
  if (p.concepts.length) lines.push(`**Topics:** ${p.concepts.join(", ")}`);

  if (p.abstract) {
    const snippet = p.abstract.length > 400
      ? p.abstract.slice(0, 397) + "..."
      : p.abstract;
    lines.push(`\n**Abstract:** ${snippet}`);
  }

  return lines.join("\n");
}

// ── Tool: find_papers ─────────────────────────────────────────────────────────

// @ts-expect-error TS2589 — Zod inference depth with MCP SDK generics
server.tool(
  "find_papers",
  "Search OpenAlex for relevant research papers. Returns metadata, abstracts, and PDF links for open-access works.",
  {
    query: z.string().min(2).describe("Research topic or keywords to search for"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Number of papers to return (1–10). Default: 5"),
    open_access_only: z
      .boolean()
      .default(true)
      .describe("Only return papers with a free PDF available. Default: true"),
    from_year: z
      .number()
      .int()
      .min(1900)
      .max(2026)
      .optional()
      .describe("Only include papers published from this year onwards"),
    sort_by: z
      .enum(["relevance", "citations", "recent"])
      .default("relevance")
      .describe("Sort order: relevance (default), most cited, or most recent"),
  },
  async ({ query, limit, open_access_only, from_year, sort_by }) => {
    try {
      const result = await searchPapers(query, {
        limit,
        openAccessOnly: open_access_only,
        fromYear: from_year,
        sortBy: sort_by,
      });

      if (result.papers.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No papers found for "${query}".\n\nTry broadening the query, removing filters, or using different keywords.`,
            },
          ],
        };
      }

      const header = [
        `# Search Results: "${query}"`,
        `Found **${result.totalFound.toLocaleString()}** papers in OpenAlex. Showing top **${result.papers.length}**.`,
        `_Fetched at ${result.fetchedAt}_`,
        "",
      ].join("\n");

      const body = result.papers.map(formatPaper).join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: header + body }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Search failed: ${message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: get_paper_details ───────────────────────────────────────────────────

server.tool(
  "get_paper_details",
  "Fetch full metadata for a single paper using its OpenAlex ID or DOI.",
  {
    identifier: z
      .string()
      .describe(
        'OpenAlex work ID (e.g. "W2741809807") or a full DOI URL (e.g. "https://doi.org/10.1234/...")'
      ),
  },
  async ({ identifier }) => {
    try {
      const isId = identifier.startsWith("W") && /^W\d+$/.test(identifier);
      const url = isId
        ? `https://api.openalex.org/works/${identifier}${process.env.OPENALEX_EMAIL ? `?mailto=${process.env.OPENALEX_EMAIL}` : ""}`
        : `https://api.openalex.org/works/doi:${encodeURIComponent(identifier)}${process.env.OPENALEX_EMAIL ? `?mailto=${process.env.OPENALEX_EMAIL}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Paper not found`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const work = (await res.json()) as any;
      const formatted = formatPaper(
        {
          id: work.id as string,
          title: (work.display_name ?? work.title) as string,
          authors: ((work.authorships ?? []) as Array<{ author: { display_name: string } }>)
            .slice(0, 5)
            .map((a) => a.author.display_name),
          year: work.publication_year as number | null,
          doi: work.doi as string | null,
          abstract: reconstructAbstractInline(
            work.abstract_inverted_index as Record<string, number[]> | null
          ),
          citedByCount: (work.cited_by_count as number) ?? 0,
          isOpenAccess: (work.open_access?.is_oa as boolean) ?? false,
          oaStatus: (work.open_access?.oa_status as string) ?? "unknown",
          pdfUrl: (work.open_access?.oa_url ?? work.primary_location?.pdf_url ?? null) as string | null,
          landingUrl: (work.primary_location?.landing_page_url ?? null) as string | null,
          concepts: ((work.concepts ?? []) as Array<{ score: number; display_name: string }>)
            .filter((c) => c.score > 0.4)
            .slice(0, 6)
            .map((c) => c.display_name),
          source: (work.primary_location?.source?.display_name ?? null) as string | null,
        },
        0
      );

      return { content: [{ type: "text", text: formatted }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Failed to fetch paper: ${message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: list_related_concepts ───────────────────────────────────────────────

server.tool(
  "list_related_concepts",
  "Return the top OpenAlex concepts related to a research query. Useful for scoping a knowledge base or suggesting related searches.",
  {
    query: z.string().describe("Research topic to find related concepts for"),
  },
  async ({ query }) => {
    try {
      const result = await searchPapers(query, { limit: 10, openAccessOnly: false });

      // Aggregate concept scores across all papers
      const conceptMap = new Map<string, { score: number; count: number }>();
      for (const paper of result.papers) {
        for (const concept of paper.concepts) {
          const prev = conceptMap.get(concept) ?? { score: 0, count: 0 };
          conceptMap.set(concept, { score: prev.score + 1, count: prev.count + 1 });
        }
      }

      const ranked = [...conceptMap.entries()]
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 15);

      if (!ranked.length) {
        return {
          content: [{ type: "text", text: `No concepts found for "${query}".` }],
        };
      }

      const lines = [
        `# Related Concepts for "${query}"`,
        "",
        ...ranked.map(([name, { count }], i) => `${i + 1}. **${name}** (appeared in ${count}/${result.papers.length} top papers)`),
        "",
        "_Derived from OpenAlex concept tagging across the top 10 most relevant papers._",
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Failed: ${message}` }],
        isError: true,
      };
    }
  }
);

// ── Inline abstract helper (needed for get_paper_details) ─────────────────────

function reconstructAbstractInline(
  invertedIndex: Record<string, number[]> | null
): string | null {
  if (!invertedIndex) return null;
  const wordMap = new Map<number, string>();
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) wordMap.set(pos, word);
  }
  return [...wordMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, w]) => w)
    .join(" ");
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Research Synthesis MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});