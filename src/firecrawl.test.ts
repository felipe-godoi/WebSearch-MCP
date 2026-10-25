import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import { classifyError, FirecrawlClient, normalizeSearchResults } from "./firecrawl.js";

const v1Item = { title: "T1", url: "https://example.com/1", description: "d1", markdown: "# one" };
const web = [
  { title: "W1", url: "https://example.com/w1", description: "web 1", markdown: "# web 1" },
  { title: "W2", url: "https://example.com/w2", description: "web 2", metadata: { siteName: "Ex", author: "Ann" } },
];
const news = [{ title: "N1", url: "https://example.com/n1", snippet: "news 1", date: "1 day ago" }];

describe("normalizeSearchResults", () => {
  it("reads the v1 shape: data is an array", () => {
    const out = normalizeSearchResults({ success: true, data: [v1Item] });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], {
      title: "T1",
      snippet: "d1",
      text: "# one",
      url: "https://example.com/1",
      siteName: "",
      byline: "",
    });
  });

  it("reads the v2 shape: data.web and data.news are arrays", () => {
    const out = normalizeSearchResults({ success: true, data: { web, news } });
    assert.deepEqual(
      out.map((r) => r.url),
      ["https://example.com/w1", "https://example.com/w2", "https://example.com/n1"]
    );
    assert.equal(out[0].text, "# web 1");
    assert.equal(out[1].siteName, "Ex");
    assert.equal(out[1].byline, "Ann");
    assert.equal(out[2].snippet, "news 1");
  });

  it("reads top-level web/news, results arrays and bare arrays", () => {
    assert.equal(normalizeSearchResults({ web } as any).length, 2);
    assert.equal(normalizeSearchResults({ results: [v1Item] }).length, 1);
    assert.equal(normalizeSearchResults({ results: { web } }).length, 2);
    assert.equal(normalizeSearchResults([v1Item] as any).length, 1);
  });

  it("drops duplicated urls and ignores images and junk", () => {
    const out = normalizeSearchResults({
      data: { web: [web[0], web[0]], images: [{ imageUrl: "https://example.com/i.png" }] },
    });
    assert.equal(out.length, 1);
    assert.deepEqual(normalizeSearchResults({} as any), []);
    assert.deepEqual(normalizeSearchResults({ data: null } as any), []);
    assert.deepEqual(normalizeSearchResults({ data: { web: "oops" } } as any), []);
  });
});

describe("classifyError", () => {
  it("only probes other paths on 404/405/501 and other hosts on connection errors", () => {
    assert.equal(classifyError({ response: { status: 404 } }), "next-endpoint");
    assert.equal(classifyError({ response: { status: 405 } }), "next-endpoint");
    assert.equal(classifyError({ response: { status: 500 } }), "fail");
    assert.equal(classifyError({ response: { status: 401 } }), "fail");
    assert.equal(classifyError({ code: "ECONNABORTED" }), "fail");
    assert.equal(classifyError({ code: "ECONNREFUSED" }), "next-host");
    assert.equal(classifyError({ code: "ENOTFOUND" }), "next-host");
  });
});

interface Hit {
  path: string;
  body: any;
}

function startMock(handler: (req: http.IncomingMessage, res: http.ServerResponse, hit: Hit) => void) {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const hit = { path: req.url || "", body: raw ? JSON.parse(raw) : null };
      hits.push(hit);
      handler(req, res, hit);
    });
  });
  return new Promise<{ url: string; hits: Hit[]; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        hits,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      });
    });
  });
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

describe("FirecrawlClient against a mock Firecrawl", () => {
  const closers: Array<() => void> = [];
  after(() => closers.forEach((c) => c()));

  it("falls back from a missing /v1/search to /v2/search and reads data.web", async () => {
    const mock = await startMock((_req, res, hit) => {
      if (hit.path === "/v2/search") return json(res, 200, { success: true, data: { web, news } });
      json(res, 404, { error: "not found" });
    });
    closers.push(mock.close);

    const client = new FirecrawlClient({ baseUrls: [mock.url], searchTimeoutMs: 20_000, pageTimeoutMs: 45_000 });
    const out = normalizeSearchResults(await client.search({ query: "q", limit: 3 }));

    assert.equal(out.length, 3);
    assert.equal(client.searchEndpoint, "/v2/search");
    assert.deepEqual(
      mock.hits.map((h) => h.path),
      ["/v1/search", "/v2/search"]
    );
    // Firecrawl is told to give up a bit before axios does, and page scrapes get their own deadline.
    const body = mock.hits[1].body;
    assert.equal(body.timeout, 15_000);
    assert.equal(body.scrapeOptions.timeout, 45_000);
    assert.deepEqual(body.scrapeOptions.formats, ["markdown"]);

    // The next search goes straight to the cached endpoint.
    await client.search({ query: "q2", limit: 3 });
    assert.equal(mock.hits[2].path, "/v2/search");
    assert.equal(mock.hits.length, 3);
  });

  it("waits for a slow (cold) search instead of aborting at the old 35 s style limit", async () => {
    const mock = await startMock((_req, res) => {
      setTimeout(() => json(res, 200, { success: true, data: { web } }), 400);
    });
    closers.push(mock.close);

    const client = new FirecrawlClient({ baseUrls: [mock.url], searchTimeoutMs: 5_000 });
    const out = normalizeSearchResults(await client.search({ query: "slow", limit: 2 }));
    assert.equal(out.length, 2);
    assert.equal(mock.hits.length, 1);
  });

  it("scrapes a heavy page with the page timeout and a long request timeout", async () => {
    const mock = await startMock((_req, res) => {
      setTimeout(() => json(res, 200, { success: true, data: { markdown: "# heavy" } }), 400);
    });
    closers.push(mock.close);

    const client = new FirecrawlClient({ baseUrls: [mock.url], scrapeTimeoutMs: 5_000, pageTimeoutMs: 60_000 });
    const out = await client.scrape("https://example.com/heavy");
    assert.equal(out.data?.markdown, "# heavy");
    assert.equal(mock.hits[0].body.timeout, 60_000);
    assert.equal(client.scrapeEndpoint, "/v1/scrape");
  });

  it("does not repeat a slow search on every endpoint when it times out", async () => {
    const mock = await startMock(() => {
      /* never answers */
    });
    closers.push(mock.close);

    const client = new FirecrawlClient({ baseUrls: [mock.url], searchTimeoutMs: 300 });
    await assert.rejects(client.search({ query: "x", limit: 1 }), (err: any) => err.code === "ECONNABORTED");
    assert.equal(mock.hits.length, 1);
  });

  it("does not probe other endpoints after a 500", async () => {
    const mock = await startMock((_req, res) => json(res, 500, { error: "boom" }));
    closers.push(mock.close);

    const client = new FirecrawlClient({ baseUrls: [mock.url] });
    await assert.rejects(client.search({ query: "x", limit: 1 }), (err: any) => err.response?.status === 500);
    assert.equal(mock.hits.length, 1);
  });

  it("skips an unreachable host and uses the next one", async () => {
    const mock = await startMock((_req, res) => json(res, 200, { success: true, data: [v1Item] }));
    closers.push(mock.close);

    const client = new FirecrawlClient({ baseUrls: ["http://127.0.0.1:1", mock.url] });
    const out = normalizeSearchResults(await client.search({ query: "x", limit: 1 }));
    assert.equal(out.length, 1);
    assert.equal(client.workingBaseUrl, mock.url);
  });
});
