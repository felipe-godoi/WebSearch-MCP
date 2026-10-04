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
exports.YahooSearchScraper = void 0;
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const baseScraper_1 = require("./baseScraper");
/**
 * Scraper for Yahoo search engine
 * Handles searching and result parsing from Yahoo Search
 */
class YahooSearchScraper extends baseScraper_1.BaseScraper {
    constructor() {
        super('YahooSearch');
        // Yahoo uses different regional domains
        this.regionToDomain = {
            'us': 'com',
            'uk': 'co.uk',
            'ca': 'ca',
            'au': 'com.au',
            'de': 'de',
            'fr': 'fr',
            'jp': 'co.jp',
            'in': 'co.in',
            // Add more as needed
        };
        // Initialize from environment variables if available
        if (process.env.YAHOO_SEARCH_TIMEOUT) {
            this.config.timeout = parseInt(process.env.YAHOO_SEARCH_TIMEOUT, 10);
        }
        if (process.env.YAHOO_SEARCH_CACHE_EXPIRY) {
            this.config.cacheExpiry = parseInt(process.env.YAHOO_SEARCH_CACHE_EXPIRY, 10);
        }
        logger_1.logger.info('YahooSearchScraper initialized', { config: this.config });
    }
    /**
     * Main method to search Yahoo
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
                logger_1.logger.info('Returning cached Yahoo Search results', { query });
                return cachedResults;
            }
        }
        catch (error) {
            logger_1.logger.warn('Error getting cached Yahoo Search results', { error, query });
            // Continue with the search even if cache retrieval fails
        }
        // Start the search
        const startTime = Date.now();
        // Build Yahoo URL with parameters
        let url = this.buildYahooSearchUrl(query, options);
        try {
            logger_1.logger.info('Yahoo Search flare client get');
            // Configure FlareSolverr options
            const flareOptions = {
                maxTimeout: this.config.timeout
            };
            // Add proxy to flare options if available
            if (options.proxy) {
                const proxy = options.proxy;
                logger_1.logger.info(`Using proxy ${proxy.protocol}://${proxy.ip}:${proxy.port} for Yahoo search`);
                flareOptions.proxy = `${proxy.protocol}://${proxy.ip}:${proxy.port}`;
            }
            const response = await this.flareClient.get(url, flareOptions);
            logger_1.logger.info('Yahoo Search flare client get done');
            // Check for successful response
            if (response.status !== 'ok' || !response.solution.response) {
                logger_1.logger.warn('FlareSolverr returned non-ok status for Yahoo Search', {
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
            const allResults = this.parseYahooSearchResults(html);
            logger_1.logger.info(`Extracted ${allResults.length} total results from Yahoo Search page`);
            // Apply additional local filters if needed
            let filteredResults = allResults;
            // Slice to the requested number of results
            const finalResultCount = options.numResults || 10;
            logger_1.logger.info(`Requested ${finalResultCount} results, found ${filteredResults.length} Yahoo Search matching results`);
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
                logger_1.logger.warn('Error caching Yahoo Search results', { error, query });
                // Continue even if caching fails
            }
            return searchResults;
        }
        catch (error) {
            logger_1.logger.error(`Yahoo Search failed`, { error, query });
            return {
                query,
                results: [],
                error: error instanceof Error ? error.message : 'Unknown error occurred during Yahoo Search'
            };
        }
    }
    /**
     * Parse Yahoo search results HTML
     */
    parseYahooSearchResults(html) {
        try {
            const $ = cheerio.load(html);
            const results = [];
            // Yahoo search results are within li elements with class="algo-sr"
            $('.algo-sr').each((_, element) => {
                try {
                    // Extract the title (h3 inside the result)
                    const titleElement = $(element).find('h3');
                    const title = titleElement.text().trim();
                    // Extract the URL (from the h3 a element's href attribute)
                    const urlElement = $(element).find('h3 a');
                    let url = urlElement.attr('href') || '';
                    // Yahoo uses a redirect URL, try to extract the actual URL
                    if (url.includes('/RU=') && url.includes('/RK=')) {
                        try {
                            url = decodeURIComponent(url.split('/RU=')[1].split('/RK=')[0]);
                        }
                        catch (e) {
                            logger_1.logger.warn('Failed to extract actual URL from Yahoo redirect', { url });
                        }
                    }
                    // Extract the snippet text (from the .compText element)
                    const snippetElement = $(element).find('.compText');
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
                    logger_1.logger.warn('Error parsing Yahoo Search result element', { error });
                }
            });
            // If no results found with the first selector, try alternative selectors
            if (results.length === 0) {
                // Try another common Yahoo selector pattern
                $('#web li.first').each((_, element) => {
                    try {
                        const titleElement = $(element).find('h3.title');
                        const title = titleElement.text().trim();
                        const urlElement = $(element).find('h3.title a');
                        let url = urlElement.attr('href') || '';
                        // Yahoo uses a redirect URL, try to extract the actual URL
                        if (url.includes('/RU=') && url.includes('/RK=')) {
                            try {
                                url = decodeURIComponent(url.split('/RU=')[1].split('/RK=')[0]);
                            }
                            catch (e) {
                                logger_1.logger.warn('Failed to extract actual URL from Yahoo redirect', { url });
                            }
                        }
                        const snippetElement = $(element).find('.abs');
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
                        logger_1.logger.warn('Error parsing Yahoo Search result element (alternative selector)', { error });
                    }
                });
            }
            // Try a more generic selector if still no results
            if (results.length === 0) {
                $('div.dd.algo').each((_, element) => {
                    try {
                        const titleElement = $(element).find('h3 a');
                        const title = titleElement.text().trim();
                        let url = titleElement.attr('href') || '';
                        // Yahoo uses a redirect URL, try to extract the actual URL
                        if (url.includes('/RU=') && url.includes('/RK=')) {
                            try {
                                url = decodeURIComponent(url.split('/RU=')[1].split('/RK=')[0]);
                            }
                            catch (e) {
                                logger_1.logger.warn('Failed to extract actual URL from Yahoo redirect', { url });
                            }
                        }
                        const snippetElement = $(element).find('div.compText p');
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
                        logger_1.logger.warn('Error parsing Yahoo Search result element (second alternative selector)', { error });
                    }
                });
            }
            return results;
        }
        catch (error) {
            logger_1.logger.error('Error parsing Yahoo Search results', { error });
            return [];
        }
    }
    /**
     * Build Yahoo search URL with parameters
     */
    buildYahooSearchUrl(query, options = {}) {
        // Base URL for Yahoo search
        let domain = 'com';
        // Handle region-specific domains
        if (options.region && this.regionToDomain[options.region.toLowerCase()]) {
            domain = this.regionToDomain[options.region.toLowerCase()];
        }
        let url = `https://search.yahoo.${domain}/search?p=`;
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
            url += `&ei=UTF-8&fr=yfp-t&fp=1&toggle=1&cop=mss&lang=${options.language}`;
        }
        else {
            url += '&ei=UTF-8&fr=yfp-t&fp=1&toggle=1&cop=mss';
        }
        // Add time filter if date range is specified
        if (options.filters?.dateRange?.start) {
            const now = new Date();
            const start = new Date(options.filters.dateRange.start);
            const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 3600 * 24));
            if (diffDays <= 1) {
                url += '&age=1d'; // Past day
            }
            else if (diffDays <= 7) {
                url += '&age=1w'; // Past week
            }
            else if (diffDays <= 30) {
                url += '&age=1m'; // Past month
            }
            else if (diffDays <= 365) {
                url += '&age=1y'; // Past year
            }
        }
        // Number of results (first page is limited)
        const count = Math.min(options.numResults || 10, 50);
        url += `&n=${count}`;
        logger_1.logger.debug(`Built Yahoo Search URL: ${url}`);
        return url;
    }
}
exports.YahooSearchScraper = YahooSearchScraper;
