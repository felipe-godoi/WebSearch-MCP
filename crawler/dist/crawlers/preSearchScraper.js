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
exports.PreSearchScraper = void 0;
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const baseScraper_1 = require("./baseScraper");
/**
 * Scraper for PreSearch search engine
 * Handles searching and result parsing from PreSearch
 */
class PreSearchScraper extends baseScraper_1.BaseScraper {
    constructor() {
        super('PreSearch');
        // Initialize from environment variables if available
        if (process.env.PRESEARCH_TIMEOUT) {
            this.config.timeout = parseInt(process.env.PRESEARCH_TIMEOUT, 10);
        }
        if (process.env.PRESEARCH_CACHE_EXPIRY) {
            this.config.cacheExpiry = parseInt(process.env.PRESEARCH_CACHE_EXPIRY, 10);
        }
        logger_1.logger.info('PreSearchScraper initialized', { config: this.config });
    }
    /**
     * Main method to search PreSearch
     */
    async search(query, options = {}) {
        // Check for cached results first
        const cacheKey = this.getCacheKey(query, options);
        try {
            const cachedResults = await this.getCachedResults(cacheKey);
            if (cachedResults) {
                logger_1.logger.info('Returning cached PreSearch results', { query });
                return cachedResults;
            }
        }
        catch (error) {
            logger_1.logger.warn('Error getting cached PreSearch results', { error, query });
            // Continue with the search even if cache retrieval fails
        }
        // Start the search
        const startTime = Date.now();
        // Build PreSearch URL with parameters
        let url = this.buildPreSearchUrl(query, options);
        try {
            logger_1.logger.info('PreSearch flare client get');
            const response = await this.flareClient.get(url, {
                maxTimeout: this.config.timeout
            });
            logger_1.logger.info('PreSearch flare client get done');
            // Check for successful response
            if (response.status !== 'ok' || !response.solution.response) {
                logger_1.logger.warn('FlareSolverr returned non-ok status for PreSearch', {
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
            const allResults = this.parsePreSearchResults(html);
            logger_1.logger.info(`Extracted ${allResults.length} total results from PreSearch page`);
            // Apply additional local filters if needed
            let filteredResults = allResults;
            // Slice to the requested number of results
            const finalResultCount = options.numResults || 10;
            logger_1.logger.info(`Requested ${finalResultCount} results, found ${filteredResults.length} PreSearch matching results`);
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
                logger_1.logger.warn('Error caching PreSearch results', { error, query });
                // Continue even if caching fails
            }
            return searchResults;
        }
        catch (error) {
            logger_1.logger.error(`PreSearch search failed`, { error, query });
            return {
                query,
                results: [],
                error: error instanceof Error ? error.message : 'Unknown error occurred during PreSearch search'
            };
        }
    }
    /**
     * Parse PreSearch search results HTML
     */
    parsePreSearchResults(html) {
        try {
            const $ = cheerio.load(html);
            const results = [];
            // PreSearch results are typically within div.result-block elements
            $('.result-block').each((_, element) => {
                try {
                    // Extract the title
                    const titleElement = $(element).find('.result-title');
                    const title = titleElement.text().trim();
                    // Extract the URL
                    const urlElement = $(element).find('.result-link');
                    let url = urlElement.attr('href') || '';
                    // PreSearch often uses redirect URLs, extract the actual URL if needed
                    if (url.includes('/redir?')) {
                        try {
                            const urlParams = new URL(url, 'https://engine.presearch.org').searchParams;
                            const actualUrl = urlParams.get('url');
                            if (actualUrl) {
                                url = actualUrl;
                            }
                        }
                        catch (e) {
                            logger_1.logger.warn('Failed to extract actual URL from PreSearch redirect', { url });
                        }
                    }
                    // Extract the snippet
                    const snippetElement = $(element).find('.result-description');
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
                    logger_1.logger.warn('Error parsing PreSearch result element', { error });
                }
            });
            // Alternative selector if above doesn't work
            if (results.length === 0) {
                $('.web-result, .result').each((_, element) => {
                    try {
                        const titleElement = $(element).find('h3');
                        const title = titleElement.text().trim();
                        const urlElement = $(element).find('a');
                        let url = urlElement.attr('href') || '';
                        // Handle redirect URLs
                        if (url.includes('/redir?')) {
                            try {
                                const urlParams = new URL(url, 'https://engine.presearch.org').searchParams;
                                const actualUrl = urlParams.get('url');
                                if (actualUrl) {
                                    url = actualUrl;
                                }
                            }
                            catch (e) {
                                logger_1.logger.warn('Failed to extract actual URL from PreSearch redirect', { url });
                            }
                        }
                        const snippetElement = $(element).find('.description, .snippet');
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
                        logger_1.logger.warn('Error parsing PreSearch result element (alternative selector)', { error });
                    }
                });
            }
            return results;
        }
        catch (error) {
            logger_1.logger.error('Error parsing PreSearch results', { error });
            return [];
        }
    }
    /**
     * Build PreSearch search URL with parameters
     */
    buildPreSearchUrl(query, options = {}) {
        // Base URL for PreSearch search
        let url = 'https://engine.presearch.org/search?q=';
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
            url += `&lang=${options.language}`;
        }
        // Add region if specified (PreSearch doesn't directly support this but we can try)
        if (options.region) {
            url += `&location=${options.region.toUpperCase()}`;
        }
        // Add date filter (PreSearch doesn't support specific date ranges but has a time filter)
        if (options.filters?.dateRange?.start) {
            const now = new Date();
            const start = new Date(options.filters.dateRange.start);
            const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 3600 * 24));
            if (diffDays <= 1) {
                url += '&period=day'; // Past day
            }
            else if (diffDays <= 7) {
                url += '&period=week'; // Past week
            }
            else if (diffDays <= 30) {
                url += '&period=month'; // Past month
            }
            else if (diffDays <= 365) {
                url += '&period=year'; // Past year
            }
        }
        // Safe search off (if available)
        url += '&safesearch=0';
        logger_1.logger.debug(`Built PreSearch URL: ${url}`);
        return url;
    }
}
exports.PreSearchScraper = PreSearchScraper;
