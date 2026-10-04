#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import axios from "axios";

// Configuration
const FIRECRAWL_API_URL = (
  process.env.FIRECRAWL_API_URL ||
  process.env.API_URL ||
  "http://firecrawl-api:3002"
).replace(/\/+$/, "");

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";
const MAX_SEARCH_RESULT = parseInt(process.env.MAX_SEARCH_RESULT || "5", 10);

const CANDIDATE_BASE_URLS = [
  FIRECRAWL_API_URL,
  "http://firecrawl-api:3002",
  "http://firecrawl-api:8080",
  "http://10.0.1.60:3002",
  "http://10.0.1.60:8080",
].filter((url, idx, arr): url is string => Boolean(url) && arr.indexOf(url) === idx);

let cachedWorkingBaseUrl: string | null = null;
let cachedSearchEndpoint: string | null = null;
let cachedScrapeEndpoint: string | null = null;

interface FirecrawlSearchResult {
  title?: string;
  url?: string;
  description?: string;
  markdown?: string;
  text?: string;
  metadata?: {
    title?: string;
    description?: string;
    sourceURL?: string;
    siteName?: string;
    author?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  data?: FirecrawlSearchResult[];
  results?: FirecrawlSearchResult[];
  error?: string;
  [key: string]: any;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    metadata?: Record<string, any>;
    [key: string]: any;
  };
  error?: string;
  [key: string]: any;
}

function getFirecrawlHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (FIRECRAWL_API_KEY) {
    headers["Authorization"] = `Bearer ${FIRECRAWL_API_KEY}`;
  }
  return headers;
}

async function executeFirecrawlSearch(params: {
  query: string;
  numResults?: number;
  language?: string;
  region?: string;
  excludeDomains?: string[];
  includeDomains?: string[];
  excludeTerms?: string[];
}): Promise<FirecrawlSearchResponse> {
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

  const limit = params.numResults ?? MAX_SEARCH_RESULT;
  const requestBody = {
    query: effectiveQuery.trim(),
    limit,
    lang: params.language,
    country: params.region,
    scrapeOptions: {
      formats: ["markdown"],
    },
  };

  const headers = getFirecrawlHeaders();

  // Try cached endpoint if already known
  if (cachedWorkingBaseUrl && cachedSearchEndpoint) {
    try {
      const response = await axios.post<FirecrawlSearchResponse>(
        `${cachedWorkingBaseUrl}${cachedSearchEndpoint}`,
        requestBody,
        { headers, timeout: 35000 }
      );
      if (response.data) {
        return response.data;
      }
    } catch (err: any) {
      console.warn(
        `Cached Firecrawl search endpoint ${cachedWorkingBaseUrl}${cachedSearchEndpoint} failed (${err.message}). Probing candidate endpoints...`
      );
      cachedWorkingBaseUrl = null;
      cachedSearchEndpoint = null;
    }
  }

  const endpointCandidates = ["/v1/search", "/v2/search", "/search"];
  let lastError: any = null;

  for (const baseUrl of CANDIDATE_BASE_URLS) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    for (const endpoint of endpointCandidates) {
      const fullUrl = `${cleanBase}${endpoint}`;
      try {
        console.error(`Attempting Firecrawl search via ${fullUrl}`);
        const response = await axios.post<FirecrawlSearchResponse>(
          fullUrl,
          requestBody,
          { headers, timeout: 35000 }
        );

        if (response.status === 200 && response.data) {
          cachedWorkingBaseUrl = cleanBase;
          cachedSearchEndpoint = endpoint;
          console.error(`Firecrawl search connected successfully via ${fullUrl}`);
          return response.data;
        }
      } catch (err: any) {
        lastError = err;
        if (err.code === "ECONNREFUSED") {
          console.warn(`Connection refused at ${cleanBase}, skipping port/host...`);
          break;
        }
      }
    }
  }

  throw lastError || new Error("Failed to connect to any Firecrawl search endpoint");
}

async function executeFirecrawlScrape(
  url: string,
  formats: string[] = ["markdown"]
): Promise<FirecrawlScrapeResponse> {
  const requestBody = {
    url,
    formats,
  };
  const headers = getFirecrawlHeaders();

  if (cachedWorkingBaseUrl && cachedScrapeEndpoint) {
    try {
      const response = await axios.post<FirecrawlScrapeResponse>(
        `${cachedWorkingBaseUrl}${cachedScrapeEndpoint}`,
        requestBody,
        { headers, timeout: 35000 }
      );
      if (response.data) {
        return response.data;
      }
    } catch (err: any) {
      console.warn(
        `Cached Firecrawl scrape endpoint ${cachedWorkingBaseUrl}${cachedScrapeEndpoint} failed (${err.message}). Probing candidate endpoints...`
      );
      cachedScrapeEndpoint = null;
    }
  }

  const baseUrls = cachedWorkingBaseUrl
    ? [cachedWorkingBaseUrl, ...CANDIDATE_BASE_URLS]
    : CANDIDATE_BASE_URLS;
  const endpointCandidates = ["/v1/scrape", "/v2/scrape", "/scrape"];
  let lastError: any = null;

  for (const baseUrl of baseUrls) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    for (const endpoint of endpointCandidates) {
      const fullUrl = `${cleanBase}${endpoint}`;
      try {
        const response = await axios.post<FirecrawlScrapeResponse>(
          fullUrl,
          requestBody,
          { headers, timeout: 35000 }
        );

        if (response.status === 200 && response.data) {
          cachedWorkingBaseUrl = cleanBase;
          cachedScrapeEndpoint = endpoint;
          return response.data;
        }
      } catch (err: any) {
        lastError = err;
        if (err.code === "ECONNREFUSED") break;
      }
    }
  }

  throw lastError || new Error("Failed to connect to any Firecrawl scrape endpoint");
}

function normalizeSearchResults(rawResponse: FirecrawlSearchResponse) {
  const items: FirecrawlSearchResult[] = Array.isArray(rawResponse.data)
    ? rawResponse.data
    : Array.isArray(rawResponse.results)
      ? rawResponse.results
      : Array.isArray(rawResponse)
        ? (rawResponse as any)
        : [];

  return items.map((item) => {
    const title = item.title || item.metadata?.title || "";
    const url = item.url || item.metadata?.sourceURL || "";
    const snippet = item.description || item.metadata?.description || item.excerpt || "";
    const text = item.markdown || item.text || snippet;
    const siteName = item.metadata?.siteName || item.siteName || "";
    const byline = item.metadata?.author || item.byline || "";

    return {
      title,
      snippet,
      text,
      url,
      siteName,
      byline,
    };
  });
}

// Build the MCP tools for both local stdio and hosted HTTP transports.
function createMcpServer() {
  const server = new McpServer({
    name: "WebSearch-MCP",
    version: "2.0.0",
  });

  // Add web_search tool (Firecrawl + SearXNG powered)
  server.tool(
    "web_search",
    "Search the web for information using Firecrawl and SearXNG.\n"
    + "Use this tool to find real-time information, documentation, news, websites, and articles.\n"
    + "Returns relevant search results with titles, URLs, snippets, and clean markdown content.",
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

        if (responseData.error && (!responseData.data || responseData.data.length === 0)) {
          return {
            content: [{ type: "text", text: `Search error: ${responseData.error}` }],
            isError: true,
          };
        }

        const results = normalizeSearchResults(responseData);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: params.query,
                  results,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error("[WebSearch-MCP] Error performing web search:", error);

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

  // Add scrape_url tool
  server.tool(
    "scrape_url",
    "Scrape a specific web page URL and extract its full content as clean markdown using Firecrawl.\n"
    + "Use this when you need the complete text/markdown or metadata of a specific webpage.",
    {
      url: z.string().url().describe("The URL of the webpage to scrape"),
      formats: z
        .array(z.enum(["markdown", "html", "rawHtml"]))
        .optional()
        .describe("Formats to extract (default: ['markdown'])"),
    },
    async (params) => {
      try {
        console.error(`[WebSearch-MCP] Scraping URL with Firecrawl: ${params.url}`);
        const responseData = await executeFirecrawlScrape(params.url, params.formats || ["markdown"]);

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
                  url: params.url,
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
      firecrawlBaseUrl: cachedWorkingBaseUrl || FIRECRAWL_API_URL,
      searchEndpoint: cachedSearchEndpoint || "auto-detect",
    });
  });

  // Backward compatibility endpoint for /crawl
  app.post("/crawl", async (req, res) => {
    try {
      const responseData = await executeFirecrawlSearch(req.body);
      const results = normalizeSearchResults(responseData);
      res.json({ query: req.body.query, results, error: null });
    } catch (err: any) {
      res.status(500).json({ query: req.body.query, results: [], error: err.message });
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[WebSearch-MCP] WebSearch MCP server started");
}

main().catch((error) => {
  console.error("[WebSearch-MCP] Failed to start:", error);
  process.exit(1);
});
