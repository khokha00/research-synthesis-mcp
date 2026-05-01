# Research Synthesis MCP Server

A **zero-cost** MCP (Model Context Protocol) server that gives AI assistants
like Claude direct access to 250M+ research papers via the
[OpenAlex](https://openalex.org) API — no API key, no paywall.

---

## Tools Exposed

| Tool | Description |
|------|-------------|
| `find_papers` | Search OpenAlex with filters (OA only, year range, sort) |
| `get_paper_details` | Fetch full metadata by OpenAlex ID or DOI |
| `list_related_concepts` | Discover related topics from a seed query |

---

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. Register with Claude Desktop — see claude_desktop_config.example.json
#    Add your email for faster OpenAlex rate limits (optional but recommended)
OPENALEX_EMAIL=your@email.com node dist/index.js
```

---

## Docker

```bash
# Build
docker build -t research-synthesis-mcp .

# Run (interactive stdio — used by Claude Desktop)
docker run --rm -i -e OPENALEX_EMAIL=your@email.com research-synthesis-mcp
```

---

## Claude Desktop Registration

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "research-synthesis": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": { "OPENALEX_EMAIL": "your@email.com" }
    }
  }
}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENALEX_EMAIL` | No | Your email — grants OpenAlex "polite pool" (higher rate limits) |

---

## Architecture

```
Claude / Cursor / Gemini
        │  MCP (stdio)
        ▼
  index.ts  (MCP server + tool definitions)
        │
        ▼
  openalex.ts  (API client, abstract reconstruction, result shaping)
        │
        ▼
  OpenAlex REST API  (free, no key)
```

---

## Next Steps

- **Phase 2**: Python PDF microservice (Docling/Marker) for `extract_methodology`
- **Phase 3**: SQLite + vec0 local vector store for `build_knowledge_base`
- **Phase 4**: Ollama integration for on-device summarisation
