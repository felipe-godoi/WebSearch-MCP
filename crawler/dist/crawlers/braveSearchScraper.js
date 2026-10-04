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
exports.BraveSearchScraper = void 0;
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const baseScraper_1 = require("./baseScraper");
/**
 * Scraper for Brave Search engine
 * Handles searching and result parsing from Brave Search
 */
class BraveSearchScraper extends baseScraper_1.BaseScraper {
    constructor() {
        super('BraveSearch');
        // Initialize from environment variables if available
        if (process.env.BRAVE_SEARCH_TIMEOUT) {
            this.config.timeout = parseInt(process.env.BRAVE_SEARCH_TIMEOUT, 10);
        }
        if (process.env.BRAVE_SEARCH_CACHE_EXPIRY) {
            this.config.cacheExpiry = parseInt(process.env.BRAVE_SEARCH_CACHE_EXPIRY, 10);
        }
        logger_1.logger.info('BraveSearchScraper initialized', { config: this.config });
    }
    /**
     * Main method to search BraveSearch
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
                logger_1.logger.info('Returning cached BraveSearch results', { query });
                return cachedResults;
            }
        }
        catch (error) {
            logger_1.logger.warn('Error getting cached BraveSearch results', { error, query });
            // Continue with the search even if cache retrieval fails
        }
        // Start the search
        const startTime = Date.now();
        // Build BraveSearch URL with parameters
        let url = this.buildBraveSearchUrl(query, options);
        try {
            logger_1.logger.info('BraveSearch flare client get');
            // Configure FlareSolverr options
            const flareOptions = {
                maxTimeout: this.config.timeout
            };
            // Add proxy to flare options if available
            if (options.proxy) {
                const proxy = options.proxy;
                logger_1.logger.info(`Using proxy ${proxy.protocol}://${proxy.ip}:${proxy.port} for BraveSearch`);
                flareOptions.proxy = `${proxy.protocol}://${proxy.ip}:${proxy.port}`;
            }
            const response = await this.flareClient.get(url, flareOptions);
            logger_1.logger.info('BraveSearch flare client get done');
            // Check for successful response
            if (response.status !== 'ok' || !response.solution.response) {
                logger_1.logger.warn('FlareSolverr returned non-ok status for BraveSearch', {
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
            const allResults = this.parseBraveSearchResults(html);
            logger_1.logger.info(`Extracted ${allResults.length} total results from BraveSearch page`);
            // Apply additional local filters if needed
            let filteredResults = allResults;
            // Slice to the requested number of results
            const finalResultCount = options.numResults || 10;
            logger_1.logger.info(`Requested ${finalResultCount} results, found ${filteredResults.length} BraveSearch matching results`);
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
                logger_1.logger.warn('Error caching BraveSearch results', { error, query });
                // Continue even if caching fails
            }
            return searchResults;
        }
        catch (error) {
            logger_1.logger.error(`BraveSearch failed`, { error, query });
            return {
                query,
                results: [],
                error: error instanceof Error ? error.message : 'Unknown error occurred during BraveSearch search'
            };
        }
    }
    /**
     * Parse Brave Search results HTML
     */
    parseBraveSearchResults(html) {
        try {
            const $ = cheerio.load(html);
            const results = [];
            // Brave Search results are in article elements with data-result attribute
            $('#results > .snippet').each((_, element) => {
                try {
                    // Extract the title (in the h3 inside a .snippet-title element)
                    const titleElement = $(element).find('.title');
                    const title = titleElement.text().trim();
                    // Extract the URL (from the snippet-title a element's href attribute)
                    const urlElement = $(element).find('.heading-serpresult');
                    const url = urlElement.attr('href') || '';
                    // Extract the snippet text (from the .snippet-description element)
                    const snippetElement = $(element).find('.snippet-description');
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
                    logger_1.logger.warn('Error parsing Brave Search result element', { error });
                }
            });
            return results;
        }
        catch (error) {
            logger_1.logger.error('Error parsing Brave Search results', { error });
            return [];
        }
    }
    /**
     * Build Brave Search URL with parameters
     */
    buildBraveSearchUrl(query, options = {}) {
        // currently Brave Search is not supporting other parameters like numResults, page, etc.
        // so we need to use the default ones
        // Base URL for Brave Search
        let url = 'https://search.brave.com/search?q=';
        // Encode the main query
        url += encodeURIComponent(query);
        // Add safe search parameter
        url += '&safesearch=off';
        // Add results per page parameter
        const numResults = options.numResults || 10;
        url += '&spellcheck=0';
        logger_1.logger.debug(`Built Brave Search URL: ${url}`);
        return url;
    }
}
exports.BraveSearchScraper = BraveSearchScraper;
