#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import axios from "axios";
import {
  assertPublicDnsResolution,
  assertSafePublicUrl,
  isInternalHostname,
  isSafePublicUrl,
  resolveAndValidateFinalUrl,
  SecurityError,
} from "./ssrf.js";
import {
  DEFAULT_PAGE_TIMEOUT_MS,
  DEFAULT_SCRAPE_TIMEOUT_MS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  FirecrawlClient,
  normalizeSearchResults,
} from "./firecrawl.js";

// Configuration
const FIRECRAWL_API_URL = (
  process.env.FIRECRAWL_API_URL ||
  process.env.API_URL ||
  "http://firecrawl-api:3002"
).replace(/\/+$/, "");

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";
const MAX_SEARCH_RESULT = parseInt(process.env.MAX_SEARCH_RESULT || "5", 10);

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CANDIDATE_BASE_URLS = [
  FIRECRAWL_API_URL,
  "http://firecrawl-api:3002",
  "http://firecrawl-api:8080",
  "http://10.0.1.60:3002",
  "http://10.0.1.60:8080",
].filter((url, idx, arr): url is string => Boolean(url) && arr.indexOf(url) === idx);

// Firecrawl search scrapes every result, which takes 20-40 s on a cold start,
// and heavy pages need up to a minute: the old 35 s timeout cut both.
const firecrawl = new FirecrawlClient({
  baseUrls: CANDIDATE_BASE_URLS,
  apiKey: FIRECRAWL_API_KEY,
  searchTimeoutMs: positiveInt(process.env.FIRECRAWL_SEARCH_TIMEOUT_MS, DEFAULT_SEARCH_TIMEOUT_MS),
  scrapeTimeoutMs: positiveInt(process.env.FIRECRAWL_SCRAPE_TIMEOUT_MS, DEFAULT_SCRAPE_TIMEOUT_MS),
  pageTimeoutMs: positiveInt(process.env.FIRECRAWL_PAGE_TIMEOUT_MS, DEFAULT_PAGE_TIMEOUT_MS),
});

/**
 * Validates search query and domain filters to ensure they do not target
 * internal network addresses, containers, or private IP ranges.
 */
async function validateSearchInputs(params: {
  query: string;
  includeDomains?: string[];
  excludeDomains?: string[];
}): Promise<void> {
  // Check if query contains internal URLs or hostnames
  const queryTokens = params.query.split(/\s+/);
  for (const token of queryTokens) {
    const cleanToken = token.replace(/^[<"'(]+|[>"')]+$/g, "");
    if (cleanToken.includes("://") || cleanToken.startsWith("site:")) {
      const rawHost = cleanToken.replace(/^site:/i, "");
      try {
        const withProto = rawHost.includes("://") ? rawHost : `http://${rawHost}`;
        const parsed = new URL(withProto);
        if (parsed.hostname && isInternalHostname(parsed.hostname)) {
          throw new SecurityError(
            `Search query targets internal or private hostname "${parsed.hostname}". Access is blocked (SSRF protection).`
          );
        }
      } catch (e: any) {
        if (e instanceof SecurityError) throw e;
      }
    }
  }

  // Validate includeDomains
  if (params.includeDomains?.length) {
    for (const domain of params.includeDomains) {
      const clean = domain.trim().toLowerCase();
      if (isInternalHostname(clean)) {
        throw new SecurityError(
          `Domain "${domain}" in includeDomains is an internal or private address. Access is blocked (SSRF protection).`
        );
      }
      await assertPublicDnsResolution(clean);
    }
  }

  // Validate excludeDomains
  if (params.excludeDomains?.length) {
    for (const domain of params.excludeDomains) {
      const clean = domain.trim().toLowerCase();
      if (isInternalHostname(clean)) {
        throw new SecurityError(
          `Domain "${domain}" in excludeDomains is an internal or private address. Access is blocked (SSRF protection).`
        );
      }
      await assertPublicDnsResolution(clean);
    }
  }
}

async function executeFirecrawlSearch(params: {
  query: string;
  numResults?: number;
  language?: string;
  region?: string;
  excludeDomains?: string[];
  includeDomains?: string[];
  excludeTerms?: string[];
}) {
  // Pre-validate search inputs against SSRF attacks
  await validateSearchInputs(params);

  let effectiveQuery = params.query;
  if (params.includeDomains?.length) {
    effectiveQuery += " " + params.includeDomains.map((d) => `site:${d}`).join(" ");
  }
  if (params.excludeDomains?.length) {
    effectiveQuery += " " + params.excludeDomains.map((d) => `-site:${d}`).join(" ");
  }
  if (params.excludeTerms?.length) {
    effectiveQuery += " " + params.excludeTerms.map((t) => `-"${t}"`).join(" ");
  }

  return firecrawl.search({
    query: effectiveQuery.trim(),
    limit: params.numResults ?? MAX_SEARCH_RESULT,
    language: params.language,
    region: params.region,
  });
}

function executeFirecrawlScrape(url: string, formats: string[] = ["markdown"]) {
  return firecrawl.scrape(url, formats);
}

// Build the MCP tools for both local stdio and hosted HTTP transports.
function createMcpServer() {
  const server = new McpServer({
    name: "WebSearch-MCP",
    version: "2.1.0",
  });

  // Add web_search tool (Firecrawl + SearXNG powered with strict SSRF protection)
  server.tool(
    "web_search",
    "Search the web for information using Firecrawl and SearXNG.\n"
    + "Use this tool to find real-time information, documentation, news, websites, and articles.\n"
    + "Returns relevant search results with titles, URLs, snippets, and clean markdown content.\n"
    + "Note: Internal, private, or local network destinations are strictly blocked for security.",
    {
      query: z.string().describe("The search query to look up"),
      numResults: z
        .number()
        .optional()
        .describe(`Number of results to return (default: ${MAX_SEARCH_RESULT})`),
      language: z
        .string()
        .optional()
        .describe("Language code for search results (e.g., 'en', 'pt')"),
      region: z
        .string()
        .optional()
        .describe("Region/country code for search results (e.g., 'us', 'br')"),
      excludeDomains: z
        .array(z.string())
        .optional()
        .describe("Domains to exclude from results"),
      includeDomains: z
        .array(z.string())
        .optional()
        .describe("Only include these domains in results"),
      excludeTerms: z
        .array(z.string())
        .optional()
        .describe("Terms to exclude from results"),
      resultType: z
        .enum(["all", "news", "blogs"])
        .optional()
        .describe("Type of results to return"),
    },
    async (params) => {
      try {
        console.error(`[WebSearch-MCP] Performing Firecrawl web search for: ${params.query}`);

        const responseData = await executeFirecrawlSearch(params);

        const rawResults = normalizeSearchResults(responseData);

        if (responseData.error && rawResults.length === 0) {
          return {
            content: [{ type: "text", text: `Search error: ${responseData.error}` }],
            isError: true,
          };
        }

        // Security filter: Verify that NONE of the search result URLs point to private/internal networks
        const safeResults = [];
        for (const item of rawResults) {
          if (item.url && (await isSafePublicUrl(item.url))) {
            safeResults.push(item);
          } else {
            console.warn(
              `[WebSearch-MCP] SSRF Filter: Dropped search result with internal or unsafe URL: ${item.url}`
            );
          }
        }

        if (rawResults.length === 0) {
          // Make an empty answer diagnosable from the logs: which shape came back?
          console.warn(
            `[WebSearch-MCP] Firecrawl returned no results for "${params.query}" (response keys: ${Object.keys(responseData || {}).join(",") || "none"})`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: params.query,
                  results: safeResults,
                  ...(safeResults.length === 0
                    ? {
                        warning:
                          "No results. The search engines behind Firecrawl may be rate-limited; retry later or scrape a known URL with scrape_url.",
                      }
                    : {}),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error("[WebSearch-MCP] Error performing web search:", error);

        if (error instanceof SecurityError) {
          return {
            content: [{ type: "text", text: `Security Error: ${error.message}` }],
            isError: true,
          };
        }

        if (axios.isAxiosError(error)) {
          const errorMessage =
            error.response?.data?.error ||
            error.response?.data?.message ||
            error.message;
          return {
            content: [{ type: "text", text: `Firecrawl Search Error: ${errorMessage}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Add scrape_url tool with strict SSRF validation and redirect verification
  server.tool(
    "scrape_url",
    "Scrape a specific web page URL and extract its full content as clean markdown using Firecrawl.\n"
    + "Use this when you need the complete text/markdown or metadata of a specific webpage.\n"
    + "Note: Internal, private, or local network destinations are strictly blocked for security.",
    {
      url: z.string().url().describe("The public web URL of the webpage to scrape"),
      formats: z
        .array(z.enum(["markdown", "html", "rawHtml"]))
        .optional()
        .describe("Formats to extract (default: ['markdown'])"),
    },
    async (params) => {
      try {
        console.error(`[WebSearch-MCP] SSRF validating URL: ${params.url}`);

        // Validate URL against private networks, Docker hostnames, loopbacks, and inspect redirects
        const safeUrl = await resolveAndValidateFinalUrl(params.url);

        console.error(`[WebSearch-MCP] Scraping verified safe public URL: ${safeUrl}`);
        const responseData = await executeFirecrawlScrape(safeUrl, params.formats || ["markdown"]);

        if (responseData.error && !responseData.data) {
          return {
            content: [{ type: "text", text: `Scrape error: ${responseData.error}` }],
            isError: true,
          };
        }

        const data = responseData.data || {};

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url: safeUrl,
                  markdown: data.markdown || "",
                  metadata: data.metadata || {},
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error("[WebSearch-MCP] Error scraping URL:", error);

        if (error instanceof SecurityError) {
          return {
            content: [{ type: "text", text: `Security Error: ${error.message}` }],
            isError: true,
          };
        }

        if (axios.isAxiosError(error)) {
          const errorMessage =
            error.response?.data?.error ||
            error.response?.data?.message ||
            error.message;
          return {
            content: [{ type: "text", text: `Firecrawl Scrape Error: ${errorMessage}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

function isAuthorized(header: string | undefined, expectedKey: string): boolean {
  if (!expectedKey || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(expectedKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function startHttpServer() {
  const apiKey = process.env.MCP_API_KEY || "";
  if (!apiKey) {
    throw new Error("MCP_API_KEY is required when MCP_TRANSPORT=http");
  }

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Health endpoint
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      backend: "firecrawl",
      firecrawlBaseUrl: firecrawl.workingBaseUrl || FIRECRAWL_API_URL,
      searchEndpoint: firecrawl.searchEndpoint || "auto-detect",
      ssrfProtection: "active",
    });
  });

  // Backward compatibility endpoint for /crawl
  app.post("/crawl", async (req, res) => {
    try {
      const responseData = await executeFirecrawlSearch(req.body);
      const rawResults = normalizeSearchResults(responseData);
      const safeResults = [];
      for (const item of rawResults) {
        if (item.url && (await isSafePublicUrl(item.url))) {
          safeResults.push(item);
        }
      }
      res.json({ query: req.body.query, results: safeResults, error: null });
    } catch (err: any) {
      const statusCode = err instanceof SecurityError ? 403 : 500;
      res.status(statusCode).json({ query: req.body.query, results: [], error: err.message });
    }
  });

  // MCP Streamable HTTP transport endpoint
  app.post("/mcp", async (req, res) => {
    if (!isAuthorized(req.header("authorization"), apiKey)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[WebSearch-MCP] MCP HTTP request failed:", error);
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.all("/mcp", (_req, res) => res.sendStatus(405));

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";

  app.listen(port, host, () => {
    console.error(`[WebSearch-MCP] Listening on ${host}:${port}`);
    console.error(`[WebSearch-MCP] Target Firecrawl API: ${FIRECRAWL_API_URL}`);
    console.error("[WebSearch-MCP] SSRF Protection: ACTIVE");
  });
}

// Main function to select the MCP transport.
async function main() {
  if ((process.env.MCP_TRANSPORT || "stdio").toLowerCase() === "http") {
    await startHttpServer();
    return;
  }

  const server = createMcpServer();

  console.error("[WebSearch-MCP] Starting WebSearch MCP server (stdio mode)...");
  console.error(`[WebSearch-MCP] Target Firecrawl API: ${FIRECRAWL_API_URL}`);
  console.error("[WebSearch-MCP] SSRF Protection: ACTIVE");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[WebSearch-MCP] WebSearch MCP server started");
}

main().catch((error) => {
  console.error("[WebSearch-MCP] Failed to start:", error);
  process.exit(1);
});
