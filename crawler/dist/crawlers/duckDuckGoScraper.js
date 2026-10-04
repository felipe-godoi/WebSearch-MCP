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
exports.DuckDuckGoScraper = void 0;
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const baseScraper_1 = require("./baseScraper");
/**
 * Scraper for DuckDuckGo search engine
 * Handles searching and result parsing from DuckDuckGo
 */
class DuckDuckGoScraper extends baseScraper_1.BaseScraper {
    constructor() {
        super('DuckDuckGo');
        // Initialize from environment variables if available
        if (process.env.DUCKDUCKGO_TIMEOUT) {
            this.config.timeout = parseInt(process.env.DUCKDUCKGO_TIMEOUT, 10);
        }
        if (process.env.DUCKDUCKGO_CACHE_EXPIRY) {
            this.config.cacheExpiry = parseInt(process.env.DUCKDUCKGO_CACHE_EXPIRY, 10);
        }
        logger_1.logger.info('DuckDuckGoScraper initialized', { config: this.config });
    }
    /**
     * Main method to search DuckDuckGo
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
                logger_1.logger.info('Returning cached DuckDuckGo results', { query });
                return cachedResults;
            }
        }
        catch (error) {
            logger_1.logger.warn('Error getting cached DuckDuckGo results', { error, query });
            // Continue with the search even if cache retrieval fails
        }
        // Start the search
        const startTime = Date.now();
        // Build DuckDuckGo URL with parameters
        let url = this.buildDuckDuckGoUrl(query, options);
        try {
            logger_1.logger.info('DuckDuckGo flare client get');
            // Configure FlareSolverr options
            const flareOptions = {
                maxTimeout: this.config.timeout
            };
            // Add proxy to flare options if available
            if (options.proxy) {
                const proxy = options.proxy;
                logger_1.logger.info(`Using proxy ${proxy.protocol}://${proxy.ip}:${proxy.port} for DuckDuckGo search`);
                flareOptions.proxy = `${proxy.protocol}://${proxy.ip}:${proxy.port}`;
            }
            const response = await this.flareClient.get(url, flareOptions);
            logger_1.logger.info('DuckDuckGo flare client get done');
            // Check for successful response
            if (response.status !== 'ok' || !response.solution.response) {
                logger_1.logger.warn('FlareSolverr returned non-ok status for DuckDuckGo', {
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
            const allResults = this.parseDuckDuckGoResults(html);
            logger_1.logger.info(`Extracted ${allResults.length} total results from DuckDuckGo page`);
            // Apply additional local filters if needed
            let filteredResults = allResults;
            // Slice to the requested number of results
            const finalResultCount = options.numResults || 10;
            logger_1.logger.info(`Requested ${finalResultCount} results, found ${filteredResults.length} DuckDuckGo matching results`);
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
                logger_1.logger.warn('Error caching DuckDuckGo results', { error, query });
                // Continue even if caching fails
            }
            return searchResults;
        }
        catch (error) {
            logger_1.logger.error(`DuckDuckGo search failed`, { error, query });
            return {
                query,
                results: [],
                error: error instanceof Error ? error.message : 'Unknown error occurred during DuckDuckGo search'
            };
        }
    }
    /**
     * Extract the real URL from a DuckDuckGo redirect URL
     * DuckDuckGo redirect URLs are in format: //duckduckgo.com/l/?uddg=ENCODED_URL&rut=HASH
     */
    extractRealUrl(redirectUrl) {
        try {
            // Handle cases where the URL doesn't need extraction
            if (!redirectUrl.includes('duckduckgo.com/l/')) {
                return redirectUrl;
            }
            // Extract the uddg parameter which contains the encoded target URL
            const match = redirectUrl.match(/[?&]uddg=([^&]+)/);
            if (match && match[1]) {
                // Decode the URL - apply decodeURIComponent twice to handle double-encoded characters
                // First decoding handles the uddg parameter encoding, second handles any encoded chars in the URL itself
                return decodeURIComponent(decodeURIComponent(match[1]));
            }
            logger_1.logger.warn('Failed to extract real URL from DuckDuckGo redirect', { redirectUrl });
            return redirectUrl;
        }
        catch (error) {
            logger_1.logger.warn('Error extracting real URL from DuckDuckGo redirect', { error, redirectUrl });
            return redirectUrl;
        }
    }
    /**
     * Parse DuckDuckGo search results HTML
     */
    parseDuckDuckGoResults(html) {
        try {
            const $ = cheerio.load(html);
            const results = [];
            // DuckDuckGo results are in article elements with data-testid="result"
            $('.results .result').each((_, element) => {
                try {
                    // Extract the title (h2 inside the result)
                    const titleElement = $(element).find('h2');
                    const title = titleElement.text().trim();
                    // Extract the URL (from the h2 a element's href attribute)
                    const urlElement = $(element).find('h2 a');
                    let url = urlElement.attr('href') || '';
                    // Extract the real URL from DuckDuckGo's redirect URL
                    url = this.extractRealUrl(url);
                    // Extract the snippet text (from the element with data-testid="snippet")
                    const snippetElement = $(element).find('.result__snippet');
                    const snippet = snippetElement.text().trim();
                    // Extract domain from URL
                    let domain = '';
                    try {
                        domain = new URL(url).hostname;
                    }
                    catch (e) {
                        logger_1.logger.warn('Failed to parse URL', { url });
                    }
                    // Only add results with all required fields
                    if (title && url && snippet) {
                        results.push({
                            title,
                            url,
                            snippet,
                            domain
                        });
                    }
                }
                catch (error) {
                    logger_1.logger.warn('Error parsing DuckDuckGo result element', { error });
                }
            });
            return results;
        }
        catch (error) {
            logger_1.logger.error('Error parsing DuckDuckGo results', { error });
            return [];
        }
    }
    /**
     * Build DuckDuckGo search URL with parameters
     */
    buildDuckDuckGoUrl(query, options = {}) {
        // DuckDuckGo base URL
        let url = 'https://html.duckduckgo.com/html';
        // Add the HTML search endpoint
        url += '?q=';
        // Start building the query
        let fullQuery = query;
        // Handle site filters for included domains
        if (options.filters?.includeDomains && options.filters.includeDomains.length > 0) {
            const includeSites = options.filters.includeDomains.map(domain => `site:${domain}`).join(' OR ');
            fullQuery += ` (${includeSites})`;
        }
        // Handle domains to exclude
        const domainsToExclude = [...(options.filters?.excludeDomains || [])];
        // Add blacklisted domains if provided
        if (options.filters?.blacklistedDomains && options.filters.blacklistedDomains.length > 0) {
            domainsToExclude.push(...options.filters.blacklistedDomains);
        }
        // Deduplicate domains
        const uniqueDomainsToExclude = [...new Set(domainsToExclude)];
        // Add domains to exclude
        if (uniqueDomainsToExclude.length > 0) {
            uniqueDomainsToExclude.forEach(domain => {
                fullQuery += ` -site:${domain}`;
            });
        }
        // Add terms to exclude
        if (options.filters?.excludeTerms && options.filters.excludeTerms.length > 0) {
            options.filters.excludeTerms.forEach(term => {
                fullQuery += ` -${term}`;
            });
        }
        // Encode the query
        url += encodeURIComponent(fullQuery);
        // Add language if specified
        if (options.language) {
            url += `&kl=${options.language}`;
        }
        // Add time filter if date range is specified
        if (options.filters?.dateRange?.start) {
            const now = new Date();
            const start = new Date(options.filters.dateRange.start);
            const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 3600 * 24));
            // DuckDuckGo time filter options
            if (diffDays <= 1) {
                url += '&df=d'; // Past day
            }
            else if (diffDays <= 7) {
                url += '&df=w'; // Past week
            }
            else if (diffDays <= 30) {
                url += '&df=m'; // Past month
            }
            else if (diffDays <= 365) {
                url += '&df=y'; // Past year
            }
        }
        // Turn off safe search
        url += '&kp=-2';
        // Disable advertisements
        url += '&k1=-1';
        logger_1.logger.debug(`Built DuckDuckGo URL: ${url}`);
        return url;
    }
}
exports.DuckDuckGoScraper = DuckDuckGoScraper;
