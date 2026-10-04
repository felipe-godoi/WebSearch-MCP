#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import axios from "axios";

// Configuration
const API_URL = process.env.API_URL || "http://localhost:3001";
const MAX_SEARCH_RESULT = parseInt(process.env.MAX_SEARCH_RESULT || "5", 10);

// Interface definitions based on swagger.json
interface CrawlRequest {
  query: string;
  numResults?: number;
  language?: string;
  region?: string;
  filters?: {
    excludeDomains?: string[];
    includeDomains?: string[];
    excludeTerms?: string[];
    resultType?: "all" | "news" | "blogs";
  };
}

interface CrawlResult {
  url: string;
  title: string;
  excerpt: string;
  text?: string;
  html?: string;
  siteName?: string;
  byline?: string;
  error?: string | null;
}

interface CrawlResponse {
  query: string;
  results: CrawlResult[];
  error: string | null;
}

// Build the same MCP tools for both local stdio and hosted HTTP transports.
function createMcpServer() {
  // Create an MCP server
  const server = new McpServer({
    name: "WebSearch-MCP",
    version: "1.0.0",
  });

  // Add a web_search tool
  server.tool(
    "web_search",
    "Search the web for information.\n"
    + "Use this tool when you need to search the web for information.\n"
    + "You can use this tool to search for news, blogs, or all types of information.\n"
    + "You can also use this tool to search for information about a specific company or product.\n"
    + "You can also use this tool to search for information about a specific person.\n"
    + "You can also use this tool to search for information about a specific product.\n"
    + "You can also use this tool to search for information about a specific company.\n"
    + "You can also use this tool to search for information about a specific event.\n"
    + "You can also use this tool to search for information about a specific location.\n"
    + "You can also use this tool to search for information about a specific thing.\n"
    + "If you request search with 1 result number and failed, retry with bigger results number.",
    {
      query: z.string().describe("The search query to look up"),
      numResults: z
        .number()
        .optional()
        .describe(
          `Number of results to return (default: ${MAX_SEARCH_RESULT})`
        ),
      language: z
        .string()
        .optional()
        .describe("Language code for search results (e.g., 'en')"),
      region: z
        .string()
        .optional()
        .describe("Region code for search results (e.g., 'us')"),
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
        console.error(`Performing web search for: ${params.query}`);

        // Prepare request payload for crawler API
        const requestPayload: CrawlRequest = {
          query: params.query,
          numResults: params.numResults ?? MAX_SEARCH_RESULT,
          language: params.language,
          region: params.region,
          filters: {
            excludeDomains: params.excludeDomains,
            includeDomains: params.includeDomains,
            excludeTerms: params.excludeTerms,
            resultType: params.resultType as "all" | "news" | "blogs",
          },
        };

        // Call the crawler API
        console.error(`Sending request to ${API_URL}/crawl`);
        const response = await axios.post<CrawlResponse>(
          `${API_URL}/crawl`,
          requestPayload
        );

        if (response.data.error && (!response.data.results || response.data.results.length === 0)) {
          return {
            content: [{ type: "text", text: `Search error: ${response.data.error}` }],
            isError: true,
          };
        }

        // Format the response for the MCP client
        const results = (response.data.results || []).map((result) => ({
          title: result.title,
          snippet: result.excerpt || (result as any).snippet || "",
          text: result.text || result.excerpt || (result as any).snippet || "",
          url: result.url,
          siteName: result.siteName || "",
          byline: result.byline || "",
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query: response.data.query,
                  results: results,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error("Error performing web search:", error);

        if (axios.isAxiosError(error)) {
          const errorMessage = error.response?.data?.error || error.message;
          return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
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
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

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
      console.error("MCP HTTP request failed:", error);
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.all("/mcp", (_req, res) => res.sendStatus(405));
  app.listen(Number(process.env.PORT || 3000), process.env.HOST || "0.0.0.0", () => {
    console.error(`WebSearch MCP listening on port ${process.env.PORT || 3000}`);
    console.error(`Using crawler API: ${API_URL}`);
  });
}

// Main function to select the MCP transport.
async function main() {
  if ((process.env.MCP_TRANSPORT || "stdio").toLowerCase() === "http") {
    await startHttpServer();
    return;
  }

  const server = createMcpServer();

  // Start receiving messages on stdin and sending messages on stdout
  console.error("Starting WebSearch MCP server...");
  console.error(`Using API_URL: ${API_URL}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WebSearch MCP server started");
}

// Start the server
main().catch((error) => {
  console.error("Failed to start WebSearch MCP server:", error);
  process.exit(1);
});
