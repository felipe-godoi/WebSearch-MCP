import axios from "axios";

export interface FirecrawlSearchResult {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
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

export interface FirecrawlSearchResponse {
  success?: boolean;
  // v1: array. v2: object with web/news/images arrays.
  data?: FirecrawlSearchResult[] | { web?: FirecrawlSearchResult[]; news?: FirecrawlSearchResult[]; [key: string]: any };
  results?: FirecrawlSearchResult[] | { web?: FirecrawlSearchResult[]; news?: FirecrawlSearchResult[]; [key: string]: any };
  web?: FirecrawlSearchResult[];
  news?: FirecrawlSearchResult[];
  error?: string;
  [key: string]: any;
}

export interface FirecrawlScrapeResponse {
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

export interface NormalizedSearchResult {
  title: string;
  snippet: string;
  text: string;
  url: string;
  siteName: string;
  byline: string;
}

export interface FirecrawlClientOptions {
  baseUrls: string[];
  apiKey?: string;
  /** axios timeout for /search (search + scrapes of every result can take 20-40 s cold). */
  searchTimeoutMs?: number;
  /** axios timeout for /scrape of a heavy page. */
  scrapeTimeoutMs?: number;
  /** Per-page timeout sent to Firecrawl in the scrape options. */
  pageTimeoutMs?: number;
}

export const DEFAULT_SEARCH_TIMEOUT_MS = 90_000;
export const DEFAULT_SCRAPE_TIMEOUT_MS = 90_000;
export const DEFAULT_PAGE_TIMEOUT_MS = 60_000;

const asArray = (value: unknown): FirecrawlSearchResult[] =>
  Array.isArray(value) ? (value as FirecrawlSearchResult[]) : [];

/**
 * Collects result items from every response shape Firecrawl has used:
 * v1 `{data:[...]}`, legacy `{results:[...]}`, a bare array and v2
 * `{data:{web:[...], news:[...]}}` (also `{web:[...]}` at the top level).
 * Web results come first, then news; images are skipped (no page text).
 */
function collectItems(raw: unknown): FirecrawlSearchResult[] {
  if (Array.isArray(raw)) return raw as FirecrawlSearchResult[];
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, any>;

  const fromContainer = (c: unknown): FirecrawlSearchResult[] => {
    if (Array.isArray(c)) return c as FirecrawlSearchResult[];
    if (c && typeof c === "object") {
      const o = c as Record<string, any>;
      return [...asArray(o.web), ...asArray(o.news), ...asArray(o.results)];
    }
    return [];
  };

  const items = [
    ...fromContainer(r.data),
    ...fromContainer(r.results),
    ...asArray(r.web),
    ...asArray(r.news),
  ];

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url || item.metadata?.sourceURL || "";
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeSearchResults(rawResponse: FirecrawlSearchResponse): NormalizedSearchResult[] {
  return collectItems(rawResponse).map((item) => {
    const title = item.title || item.metadata?.title || "";
    const url = item.url || item.metadata?.sourceURL || "";
    const snippet = item.description || item.snippet || item.metadata?.description || item.excerpt || "";
    const text = item.markdown || item.text || snippet;
    const siteName = item.metadata?.siteName || item.siteName || "";
    const byline = item.metadata?.author || item.byline || "";
    return { title, snippet, text, url, siteName, byline };
  });
}

/**
 * Decides what to do after a failed request:
 * - "next-endpoint": this route does not exist (404/405/501), try another path;
 * - "next-host": nothing is listening / reachable there, try another host;
 * - "fail": the server answered (or timed out): another path would only repeat
 *   the same slow work, so surface the error right away.
 */
export function classifyError(err: any): "next-endpoint" | "next-host" | "fail" {
  const status: number | undefined = err?.response?.status;
  if (status !== undefined) {
    return status === 404 || status === 405 || status === 501 ? "next-endpoint" : "fail";
  }
  const code: string | undefined = err?.code;
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || code === "ERR_CANCELED") return "fail";
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN"
  ) {
    return "next-host";
  }
  return "fail";
}

export class FirecrawlClient {
  private readonly baseUrls: string[];
  private readonly apiKey: string;
  private readonly searchTimeoutMs: number;
  private readonly scrapeTimeoutMs: number;
  private readonly pageTimeoutMs: number;

  workingBaseUrl: string | null = null;
  searchEndpoint: string | null = null;
  scrapeEndpoint: string | null = null;

  constructor(options: FirecrawlClientOptions) {
    this.baseUrls = options.baseUrls.map((u) => u.replace(/\/+$/, ""));
    this.apiKey = options.apiKey || "";
    this.searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.scrapeTimeoutMs = options.scrapeTimeoutMs ?? DEFAULT_SCRAPE_TIMEOUT_MS;
    this.pageTimeoutMs = options.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    return headers;
  }

  /** POSTs to the cached endpoint first, then probes host/path candidates. */
  private async post<T>(
    kind: "search" | "scrape",
    body: unknown,
    timeoutMs: number
  ): Promise<T> {
    const cachedEndpoint = kind === "search" ? this.searchEndpoint : this.scrapeEndpoint;
    const headers = this.headers();

    if (this.workingBaseUrl && cachedEndpoint) {
      try {
        const response = await axios.post<T>(`${this.workingBaseUrl}${cachedEndpoint}`, body, {
          headers,
          timeout: timeoutMs,
        });
        if (response.data) return response.data;
      } catch (err: any) {
        const action = classifyError(err);
        if (action === "fail") throw err;
        console.warn(
          `Cached Firecrawl ${kind} endpoint ${this.workingBaseUrl}${cachedEndpoint} failed (${err.message}). Probing candidate endpoints...`
        );
        if (kind === "search") this.searchEndpoint = null;
        else this.scrapeEndpoint = null;
        if (action === "next-host") this.workingBaseUrl = null;
      }
    }

    const bases = this.workingBaseUrl ? [this.workingBaseUrl, ...this.baseUrls] : this.baseUrls;
    const endpoints = [`/v1/${kind}`, `/v2/${kind}`, `/${kind}`];
    let lastError: any = null;

    for (const base of bases.filter((u, i, a) => a.indexOf(u) === i)) {
      for (const endpoint of endpoints) {
        const fullUrl = `${base}${endpoint}`;
        try {
          console.error(`Attempting Firecrawl ${kind} via ${fullUrl}`);
          const response = await axios.post<T>(fullUrl, body, { headers, timeout: timeoutMs });
          if (response.status === 200 && response.data) {
            this.workingBaseUrl = base;
            if (kind === "search") this.searchEndpoint = endpoint;
            else this.scrapeEndpoint = endpoint;
            console.error(`Firecrawl ${kind} connected successfully via ${fullUrl}`);
            return response.data;
          }
        } catch (err: any) {
          lastError = err;
          const action = classifyError(err);
          if (action === "fail") throw err;
          if (action === "next-host") {
            console.warn(`Cannot reach ${base} (${err.code}), skipping host...`);
            break;
          }
        }
      }
    }

    throw lastError || new Error(`Failed to connect to any Firecrawl ${kind} endpoint`);
  }

  search(params: { query: string; limit: number; language?: string; region?: string }): Promise<FirecrawlSearchResponse> {
    return this.post<FirecrawlSearchResponse>(
      "search",
      {
        query: params.query,
        limit: params.limit,
        lang: params.language,
        country: params.region,
        // Firecrawl's own deadline stays a little below ours so that it answers
        // (with partial results) before axios gives up.
        timeout: Math.max(this.searchTimeoutMs - 5_000, 1_000),
        scrapeOptions: {
          formats: ["markdown"],
          timeout: this.pageTimeoutMs,
        },
      },
      this.searchTimeoutMs
    );
  }

  scrape(url: string, formats: string[] = ["markdown"]): Promise<FirecrawlScrapeResponse> {
    return this.post<FirecrawlScrapeResponse>(
      "scrape",
      { url, formats, timeout: this.pageTimeoutMs },
      this.scrapeTimeoutMs
    );
  }
}
