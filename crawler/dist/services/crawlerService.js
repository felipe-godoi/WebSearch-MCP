"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrawlerService = void 0;
const contentExtractor_1 = require("./contentExtractor");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const contentCleaner_1 = require("../utils/contentCleaner");
const logger_1 = require("../utils/logger");
const searchManager_1 = require("../managers/searchManager");
class CrawlerService {
    constructor() {
        this.STORAGE_DIR = path_1.default.join(__dirname, '../../storage');
        this.RAW_DIR = path_1.default.join(__dirname, '../../storage/raw');
        this.PROCESSED_DIR = path_1.default.join(__dirname, '../../storage/processed');
        logger_1.logger.info('CrawlerService initialized');
        // Initialize services
        this.searchManager = new searchManager_1.SearchManager();
        this.extractor = new contentExtractor_1.ContentExtractor();
        this.cleaner = new contentCleaner_1.ContentCleaner();
        this.initializeStorage();
    }
    async initializeStorage() {
        // Create storage directories if they don't exist
        try {
            await promises_1.default.mkdir(this.STORAGE_DIR, { recursive: true });
            await promises_1.default.mkdir(this.RAW_DIR, { recursive: true });
            await promises_1.default.mkdir(this.PROCESSED_DIR, { recursive: true });
            logger_1.logger.info('Storage directories initialized');
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize storage directories', { error });
            // Continue even if storage initialization fails
        }
    }
    async crawl(query, options) {
        const startTime = Date.now();
        const debug = options?.debug !== undefined ? options.debug : true;
        try {
            logger_1.logger.info('Starting crawl operation', { query, options });
            // Get blacklisted domains from ContentExtractor (internal, not exposed via API)
            const blacklistedDomains = this.extractor.getBlacklistedDomains();
            logger_1.logger.debug(`Using ${blacklistedDomains.length} blacklisted domains in search filters`);
            // Update search filters with blacklisted domains (internal logic)
            const searchOptions = { ...options };
            if (!searchOptions.filters) {
                searchOptions.filters = {};
            }
            // Add blacklisted domains to filters
            searchOptions.filters.blacklistedDomains = blacklistedDomains;
            // 1. Get search results using the SearchManager, which will try multiple search engines
            const searchResults = await this.searchManager.search(query, {
                numResults: Math.min(options?.numResults ? options.numResults + 2 : 7, 20), // Add buffer for potential failures
                language: options?.language,
                region: options?.region,
                filters: searchOptions.filters
            });
            if (searchResults.error) {
                logger_1.logger.error('Error in search results', { error: searchResults.error });
                return {
                    query,
                    results: [],
                    error: searchResults.error
                };
            }
            if (!searchResults.results.length) {
                logger_1.logger.warn('No search results found', { query });
                return {
                    query,
                    results: [],
                    error: 'No search results found'
                };
            }
            // 2. Extract content from the top results
            // Make sure we get at least numResults results if available
            const requestedResults = options?.numResults || 5;
            const topResults = searchResults.results;
            // Determine content cleaning options
            const cleaningOptions = {
                removeAllSpaces: options?.removeAllSpaces || false,
                removeLineBreaks: options?.removeLineBreaks || false,
                collapseSpaces: options?.collapseSpaces !== false // Default to true unless explicitly set to false
            };
            const crawlPromises = topResults.map(async (result) => {
                try {
                    // Extract content from the URL
                    const content = await this.extractor.extract(result.url);
                    // Clean and process the content
                    let cleanedContent = { 
                        ...content,
                        title: content.title || result.title,
                        excerpt: content.excerpt || result.snippet,
                        siteName: content.siteName || result.domain || ''
                    };
                    if (content.html) {
                        // Clean the HTML content
                        const cleanedHtml = this.cleaner.cleanHtml(content.html);
                        cleanedContent.html = cleanedHtml;
                        // Extract better text from cleaned HTML if original text is empty or too short
                        if (!content.text || content.text.length < 100) {
                            cleanedContent.text = this.cleaner.extractText(cleanedHtml, cleaningOptions);
                        }
                        else {
                            // Also apply cleaning options to existing text
                            cleanedContent.text = this.cleaner.extractText(cleanedContent.text, cleaningOptions);
                        }
                        // Fix encoding issues in text and title
                        if (cleanedContent.text) {
                            cleanedContent.text = this.cleaner.fixEncoding(cleanedContent.text);
                        }
                        if (cleanedContent.title) {
                            cleanedContent.title = this.cleaner.fixEncoding(cleanedContent.title);
                        }
                    }
                    if (!cleanedContent.text || cleanedContent.text.trim().length === 0) {
                        cleanedContent.text = result.snippet || '';
                    }
                    // Remove html field if debug mode is false
                    if (!debug) {
                        const { html, ...contentWithoutHtml } = cleanedContent;
                        return contentWithoutHtml;
                    }
                    return cleanedContent;
                }
                catch (error) {
                    logger_1.logger.error('Error processing result', { url: result.url, error });
                    return {
                        url: result.url,
                        title: result.title,
                        excerpt: result.snippet,
                        snippet: result.snippet,
                        html: debug ? '' : undefined,
                        text: result.snippet || '',
                        siteName: result.domain || '',
                        error: null
                    };
                }
            });
            // Process all URLs with a timeout
            const results = await Promise.all(crawlPromises);
            // First select rich results that successfully extracted full article content
            const richResults = results.filter((r) => !r.error && r.text && r.text.replace(/\n/g, ' ').split(' ').length >= 100);
            const finalResults = [...richResults];
            // If we don't have enough rich results, include results with search snippets
            if (finalResults.length < requestedResults) {
                for (const r of results) {
                    if (!finalResults.some(fr => fr.url === r.url) && r.url && (r.title || r.text || r.excerpt)) {
                        finalResults.push({
                            ...r,
                            text: r.text || r.excerpt || r.snippet || '',
                            excerpt: r.excerpt || r.snippet || ''
                        });
                        if (finalResults.length >= requestedResults) break;
                    }
                }
            }
            const successfulResults = finalResults.slice(0, requestedResults);
            logger_1.logger.info(`Crawl completed successfully with ${successfulResults.length} results`, {
                time: Date.now() - startTime,
                query,
                searchEngine: searchResults.source
            });
            // Add the search engine source to the response
            return {
                query,
                results: successfulResults,
                source: searchResults.source
            };
        }
        catch (error) {
            logger_1.logger.error('Crawl Error:', { error, query });
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                query,
                results: [],
                error: errorMessage
            };
        }
    }
    async healthCheck() {
        try {
            return await this.searchManager.healthCheck();
        }
        catch (error) {
            logger_1.logger.error('Health check error', { error });
            return {
                status: 'down',
                scrapers: {},
                message: 'Error performing health check'
            };
        }
    }
    /**
     * Process and clean raw API response
     * @param rawResponse Raw API response
     * @param cleaningOptions Options for cleaning and formatting text
     * @returns Cleaned and structured content
     */
    async processRawResponse(rawResults, cleaningOptions) {
        try {
            const cleanedResults = this.cleaner.processRawResponse(rawResults, cleaningOptions);
            return {
                query: 'Extracted from raw response',
                results: cleanedResults
            };
        }
        catch (error) {
            logger_1.logger.error('Error processing raw response', { error });
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                query: 'Extracted from raw response',
                results: [],
                error: errorMessage
            };
        }
    }
    /**
     * Clear content cache for a specific URL or all URLs
     * @param url Optional URL to clear cache for (omit to clear all)
     */
    async clearCache(url) {
        await this.extractor.clearCache(url);
    }
}
exports.CrawlerService = CrawlerService;
