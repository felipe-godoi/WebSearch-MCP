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
exports.BingSearchScraper = void 0;
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const baseScraper_1 = require("./baseScraper");
const rotator_1 = require("../utils/rotator");
const httpClient_1 = require("../services/httpClient");
/**
 * Scraper for Bing search engine
 * Handles searching and result parsing from Bing Search
 */
class BingSearchScraper extends baseScraper_1.BaseScraper {
    constructor() {
        super('BingSearch');
        // Initialize rotator for user agents
        this.rotator = new rotator_1.Rotator();
        // Initialize HttpClient
        this.httpClient = new httpClient_1.HttpClient();
        // Initialize from environment variables if available
        if (process.env.BING_SEARCH_TIMEOUT) {
            this.config.timeout = parseInt(process.env.BING_SEARCH_TIMEOUT, 10);
        }
        if (process.env.BING_SEARCH_CACHE_EXPIRY) {
            this.config.cacheExpiry = parseInt(process.env.BING_SEARCH_CACHE_EXPIRY, 10);
        }
        logger_1.logger.info('BingSearchScraper initialized', { config: this.config });
    }
    /**
     * Main method to search Bing
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
                logger_1.logger.info('Returning cached Bing Search results', { query });
                return cachedResults;
            }
        }
        catch (error) {
            logger_1.logger.warn('Error getting cached Bing Search results', { error, query });
            // Continue with the search even if cache retrieval fails
        }
        // Start the search
        const startTime = Date.now();
        // Build Bing URL with parameters
        let url = this.buildBingSearchUrl(query, options);
        try {
            logger_1.logger.info('Starting Bing Search with HttpClient');
            // Get a random user agent
            const userAgent = this.rotator.getUserAgent();
            // Configure request options
            const requestOptions = {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Dnt': '1',
                },
                timeout: this.config.timeout
            };
            // Add proxy to request if provided
            if (options.proxy) {
                const proxy = options.proxy;
                logger_1.logger.info(`Using proxy ${proxy.protocol}://${proxy.ip}:${proxy.port} for Bing search`);
                requestOptions.proxy = proxy;
            }
            // Make direct request with HttpClient
            const response = await this.httpClient.get(url, requestOptions);
            logger_1.logger.info('Bing Search HttpClient request complete');
            // Process the HTML response
            const html = response;
            // Extract all results from the page
            const allResults = this.parseBingSearchResults(html);
            logger_1.logger.info(`Extracted ${allResults.length} total results from Bing Search page`);
            // Apply additional local filters if needed
            let filteredResults = allResults;
            // Slice to the requested number of results
            const finalResultCount = options.numResults || 10;
            logger_1.logger.info(`Requested ${finalResultCount} results, found ${filteredResults.length} Bing Search matching results`);
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
                logger_1.logger.warn('Error caching Bing Search results', { error, query });
                // Continue even if caching fails
            }
            return searchResults;
        }
        catch (error) {
            logger_1.logger.error(`Bing Search failed`, { error, query });
            return {
                query,
                results: [],
                error: error instanceof Error ? error.message : 'Unknown error occurred during Bing Search'
            };
        }
    }
    /**
     * Override healthCheck to use HttpClient directly
     */
    async healthCheck() {
        let engineStatus = false;
        const redisStatus = this.redisService.isAvailable();
        // Try a simple search to verify connectivity to Bing
        try {
            const testQuery = 'test123456789';
            const results = await this.search(testQuery, { numResults: 1 });
            engineStatus = !results.error;
        }
        catch (error) {
            logger_1.logger.error(`Bing health check test failed`, { error });
        }
        const status = {
            status: engineStatus ? 'ok' : 'down',
            flaresolverr: true, // Not using flaresolverr anymore
            google: false, // Not Google
            bing: engineStatus, // Using Bing now
            redis: redisStatus
        };
        if (!engineStatus) {
            status.message = 'Bing search is not working properly';
        }
        else if (!redisStatus) {
            status.message = 'Redis is unavailable, using in-memory cache fallback';
            status.status = 'degraded';
        }
        return status;
    }
    /**
     * Parse Bing search results HTML
     */
    parseBingSearchResults(html) {
        try {
            const $ = cheerio.load(html);
            const results = [];
            // Bing search results are within li elements with class="b_algo"
            $('.b_algo').each((_, element) => {
                try {
                    // Extract the title (h2 inside the result)
                    const titleElement = $(element).find('h2');
                    const title = titleElement.text().trim();
                    // Extract the URL from the cite element or from h2 > a href
                    let url = '';
                    const citeElement = $(element).find('cite');
                    if (citeElement.length > 0) {
                        url = citeElement.text().trim();
                    }
                    else {
                        const urlElement = $(element).find('h2 a');
                        url = urlElement.attr('href') || '';
                    }
                    // Extract the snippet text (from the .b_caption p element)
                    const snippetElement = $(element).find('.b_caption p');
                    const snippet = snippetElement.text().trim();
                    // Extract domain from URL
                    let domain = '';
                    try {
                        // If the URL doesn't start with http/https, add it
                        let processedUrl = url;
                        if (!url.startsWith('http') && !url.startsWith('https')) {
                            processedUrl = 'https://' + url;
                        }
                        domain = new URL(processedUrl).hostname;
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
                    logger_1.logger.warn('Error parsing Bing Search result element', { error });
                }
            });
            // If no results found with the b_algo selector, try alternative selectors
            if (results.length === 0) {
                $('#b_results > li').each((_, element) => {
                    try {
                        if ($(element).find('.b_title').length === 0)
                            return;
                        const titleElement = $(element).find('.b_title');
                        const title = titleElement.text().trim();
                        const urlElement = $(element).find('.b_title a');
                        const url = urlElement.attr('href') || '';
                        const snippetElement = $(element).find('.b_snippet');
                        const snippet = snippetElement.text().trim();
                        let domain = '';
                        try {
                            domain = new URL(url).hostname;
                        }
                        catch (e) {
                            logger_1.logger.warn('Failed to parse URL', { url });
                        }
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
                        logger_1.logger.warn('Error parsing Bing Search result element (alternative selector)', { error });
                    }
                });
            }
            return results;
        }
        catch (error) {
            logger_1.logger.error('Error parsing Bing Search results', { error });
            return [];
        }
    }
    /**
     * Build Bing search URL with parameters
     */
    buildBingSearchUrl(query, options = {}) {
        // Base URL for Bing search
        let url = 'https://www.bing.com/search?q=';
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
        // Add language if specified (Bing uses 'setlang' parameter)
        if (options.language) {
            url += `&setlang=${options.language}`;
        }
        // Add region/market if specified (Bing uses 'cc' for country code)
        if (options.region) {
            url += `&cc=${options.region.toUpperCase()}`;
        }
        // Add time filter if date range is specified
        if (options.filters?.dateRange?.start) {
            const now = new Date();
            const start = new Date(options.filters.dateRange.start);
            const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 3600 * 24));
            // Bing time filter options
            if (diffDays <= 1) {
                url += '&filters=ex1:"ez1"'; // Past 24 hours
            }
            else if (diffDays <= 7) {
                url += '&filters=ex1:"ez2"'; // Past week
            }
            else if (diffDays <= 30) {
                url += '&filters=ex1:"ez3"'; // Past month
            }
            else if (diffDays <= 365) {
                url += '&filters=ex1:"ez5"'; // Past year
            }
        }
        // Safe search off
        url += '&safesearch=off';
        // Number of results (first page is always limited but we can try)
        const count = Math.min(options.numResults || 10, 50);
        url += `&count=${count}`;
        // Add additional parameters to avoid personalized results
        url += '&qft=+filterui:msite-youtube.com'; // Filter some default results
        logger_1.logger.debug(`Built Bing Search URL: ${url}`);
        return url;
    }
}
exports.BingSearchScraper = BingSearchScraper;
