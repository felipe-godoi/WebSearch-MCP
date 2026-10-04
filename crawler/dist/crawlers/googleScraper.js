"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleScraper = void 0;
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const baseScraper_1 = require("./baseScraper");
class GoogleScraper extends baseScraper_1.BaseScraper {
    constructor() {
        super('Google');
        logger_1.logger.info('GoogleScraper initialized', { config: this.config });
    }
    /**
     * Main method to search Google
     */
    async search(query, options = {}) {
        // Refactor to use searchWithProxyFallback method
        return this.searchWithProxyFallback(query, options, this.executeSearch.bind(this));
    }
    /**
     * Execute the actual search (internal implementation)
     * This is called by search() directly or via searchWithProxyFallback
     */
    async executeSearch(query, options = {}) {
        // Check for cached results first
        const cacheKey = this.getCacheKey(query, options);
        try {
            const cachedResults = await this.getCachedResults(cacheKey);
            if (cachedResults) {
                logger_1.logger.info('Returning cached Google results', { query });
                return cachedResults;
            }
        }
        catch (error) {
            logger_1.logger.warn('Error getting cached Google results', { error, query });
            // Continue with the search even if cache retrieval fails
        }
        // Start the search
        const startTime = Date.now();
        // Build Google URL with both basic params and filters
        let url = this.buildGoogleUrl(query, options);
        try {
            // Let FlareSolverr handle user agent rotation
            logger_1.logger.info('Google flare client get');
            // Add proxy to FlareSolverr request if provided in options
            const flareOptions = {
                maxTimeout: this.config.timeout
            };
            // Add proxy to flare options if available
            if (options.proxy) {
                const proxy = options.proxy;
                logger_1.logger.info(`Using proxy ${proxy.protocol}://${proxy.ip}:${proxy.port} for Google search`);
                flareOptions.proxy = `${proxy.protocol}://${proxy.ip}:${proxy.port}`;
            }
            const response = await this.flareClient.get(url, flareOptions);
            logger_1.logger.info('Google flare client get done');
            // Check for successful response
            if (response.status !== 'ok' || !response.solution.response) {
                logger_1.logger.warn('FlareSolverr returned non-ok status for Google', {
                    status: response.status,
                    message: response.message
                });
                return {
                    query,
                    results: [],
                    error: 'FlareSolverr returned non-ok status'
                };
            }
            // Parse the HTML response
            const html = response.solution.response;
            // Extract all results from the page
            const allResults = await this.parseGoogleResults(html);
            logger_1.logger.info(`Extracted ${allResults.length} total results from Google search page`);
            if (allResults.length === 0) {
                logger_1.logger.warn('Google search returned no valid external URLs');
                return {
                    query,
                    results: [],
                    error: 'Google search returned no valid results'
                };
            }
            // Apply additional local filters if needed
            let filteredResults = allResults;
            // Slice to the requested number of results
            const finalResultCount = options.numResults || 10;
            logger_1.logger.info(`Requested ${finalResultCount} results, found ${filteredResults.length} Google matching results`);
            const finalResults = filteredResults.slice(0, finalResultCount);
            // Calculate search time
            const searchTime = (Date.now() - startTime) / 1000;
            // Create the search results object
            const searchResults = {
                query,
                results: finalResults,
                totalResults: allResults.length,
                searchTime
            };
            // Cache the results
            try {
                await this.cacheResults(cacheKey, searchResults);
            }
            catch (error) {
                logger_1.logger.warn('Error caching Google results', { error, query });
                // Continue even if caching fails
            }
            return searchResults;
        }
        catch (error) {
            logger_1.logger.error(`Google search failed`, { error, query });
            return {
                query,
                results: [],
                error: error instanceof Error ? error.message : 'Unknown error occurred during Google search'
            };
        }
    }
    /**
     * Override healthCheck to specifically check Google search engine
     */
    async healthCheck() {
        const flareSolverrStatus = await this.flareClient.healthCheck();
        const redisStatus = this.redisService.isAvailable();
        let googleStatus = false;
        if (flareSolverrStatus) {
            // Try a simple Google search to verify connectivity
            try {
                const testQuery = 'test123456789';
                const results = await this.search(testQuery, { numResults: 1 });
                googleStatus = !results.error;
            }
            catch (error) {
                logger_1.logger.error('Health check Google test failed', { error });
            }
        }
        const status = {
            status: flareSolverrStatus && googleStatus ? 'ok' : (flareSolverrStatus ? 'degraded' : 'down'),
            flaresolverr: flareSolverrStatus,
            google: googleStatus,
            redis: redisStatus
        };
        if (!flareSolverrStatus) {
            status.message = 'FlareSolverr service is unavailable';
        }
        else if (!googleStatus) {
            status.message = 'Google search is not working properly';
        }
        else if (!redisStatus) {
            status.message = 'Redis is unavailable, using in-memory cache fallback';
            // Still return ok or degraded since the service can function without Redis
            status.status = 'degraded';
        }
        return status;
    }
    async resolveGoogleUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return null;
        let url = rawUrl.trim();
        // 1. Direct external HTTP/HTTPS URL not on google domain
        if ((url.startsWith('http://') || url.startsWith('https://')) && !url.includes('google.com/url') && !url.includes('google.com/goto') && !url.includes('google.com/search')) {
            return url;
        }
        // 2. Google /url?q= redirect
        if (url.includes('/url?q=') || url.includes('/url?url=')) {
            try {
                const parsed = new URL(url, 'https://www.google.com');
                const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
                if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
                    return target;
                }
            } catch (e) {}
        }
        // 3. Google /goto?url= redirect
        if (url.startsWith('/goto?') || url.includes('google.com/goto?')) {
            const fullUrl = url.startsWith('/') ? `https://www.google.com${url}` : url;
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                const res = await fetch(fullUrl, {
                    redirect: 'manual',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                    }
                });
                clearTimeout(timeoutId);
                if (res.status >= 300 && res.status < 400) {
                    const loc = res.headers.get('location');
                    if (loc && (loc.startsWith('http://') || loc.startsWith('https://')) && !loc.includes('google.com/goto')) {
                        return loc;
                    }
                }
                const body = await res.text();
                const match = body.match(/<A\s+HREF="([^"]+)">/i);
                if (match && match[1] && (match[1].startsWith('http://') || match[1].startsWith('https://'))) {
                    return match[1];
                }
            } catch (e) {
                logger_1.logger.debug(`Failed to resolve Google goto URL: ${url}`, { error: e.message });
            }
        }
        return null;
    }
    /**
     * Parse Google search results HTML
     */
    async parseGoogleResults(html) {
        try {
            const $ = cheerio.load(html);
            const rawItems = [];
            // Using the same selector pattern as before
            $('div#search #rso >div').each((_, element) => {
                try {
                    const titleElement = $(element).find('h3');
                    if (!titleElement.length) return;
                    let urlElement = titleElement.closest('a');
                    if (!urlElement.length) {
                        urlElement = titleElement.find('a');
                    }
                    if (!urlElement.length) {
                        urlElement = $(element).find('a[href]:not([href^="#"]):not([href^="javascript:"])').first();
                    }
                    const rawUrl = urlElement.attr('href') || '';
                    if (!rawUrl) return;
                    const snippetElement = $(element).find('div.VwiC3b');
                    const title = titleElement.text().trim();
                    const snippet = snippetElement.length ? snippetElement.text().trim() : '';
                    rawItems.push({ title, rawUrl, snippet });
                }
                catch (error) {
                    logger_1.logger.warn('Error parsing Google result element', { error });
                }
            });
            const resolvedResults = await Promise.all(rawItems.map(async (item) => {
                const finalUrl = await this.resolveGoogleUrl(item.rawUrl);
                if (!finalUrl) return null;
                let domain = '';
                try {
                    domain = new URL(finalUrl).hostname;
                }
                catch (e) {
                    return null;
                }
                return {
                    title: item.title,
                    url: finalUrl,
                    snippet: item.snippet,
                    domain
                };
            }));
            return resolvedResults.filter((r) => r !== null);
        }
        catch (error) {
            logger_1.logger.error('Error parsing Google results', { error });
            return [];
        }
    }
    /**
     * Build Google search URL with parameters
     */
    buildGoogleUrl(query, options = {}) {
        // Base URL for Google search
        let url = 'https://www.google.com/search?q=';
        // Encode the main query
        url += encodeURIComponent(query);
        // Add language if specified
        if (options.language) {
            url += `&hl=${options.language}`;
        }
        // Add region if specified
        if (options.region) {
            url += `&gl=${options.region}`;
        }
        // Handle result types
        if (options.filters?.resultType) {
            switch (options.filters.resultType) {
                case 'news':
                    url += '&tbm=nws';
                    break;
                case 'blogs':
                    url += '&tbm=blg';
                    break;
                default:
                    // Default is web search, no need to add parameter
                    break;
            }
        }
        // Add domains to include
        if (options.filters?.includeDomains && options.filters.includeDomains.length > 0) {
            const includes = options.filters.includeDomains
                .map(domain => `site:${domain}`)
                .join(' OR ');
            url += `&as_q=${encodeURIComponent(includes)}`;
        }
        // Combine blacklisted domains with explicitly excluded domains
        const domainsToExclude = [...(options.filters?.excludeDomains || [])];
        // Add blacklisted domains if provided
        if (options.filters?.blacklistedDomains && options.filters.blacklistedDomains.length > 0) {
            domainsToExclude.push(...options.filters.blacklistedDomains);
        }
        // Deduplicate domains
        const uniqueDomainsToExclude = [...new Set(domainsToExclude)];
        // Add domains to exclude
        if (uniqueDomainsToExclude.length > 0) {
            const excludes = uniqueDomainsToExclude
                .map(domain => `-site:${domain}`)
                .join(' ');
            // Append to the query
            url += `+${encodeURIComponent(excludes)}`;
        }
        // Add date range filters if specified
        if (options.filters?.dateRange) {
            if (options.filters.dateRange.start) {
                // Format: YYYY-MM-DD
                const startDate = options.filters.dateRange.start.toISOString().split('T')[0];
                url += `&tbs=cdr:1,cd_min:${startDate}`;
            }
            if (options.filters.dateRange.end) {
                // Format: YYYY-MM-DD
                const endDate = options.filters.dateRange.end.toISOString().split('T')[0];
                url += `,cd_max:${endDate}`;
            }
        }
        // Add terms to exclude
        if (options.filters?.excludeTerms && options.filters.excludeTerms.length > 0) {
            const excludeTermsString = options.filters.excludeTerms
                .map(term => `-${term}`)
                .join(' ');
            url += `+${encodeURIComponent(excludeTermsString)}`;
        }
        // Set number of results
        url += `&num=${options.numResults || 20}`;
        // Request complete content
        url += '&complete=0&nfpr=1';
        // Safe search off
        url += '&safe=images';
        // No personalization
        url += '&pws=0';
        logger_1.logger.debug(`Built Google URL: ${url}`);
        return url;
    }
}
exports.GoogleScraper = GoogleScraper;
