"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchManager = void 0;
const logger_1 = require("../utils/logger");
const googleScraper_1 = require("../crawlers/googleScraper");
const ecosiaScraper_1 = require("../crawlers/ecosiaScraper");
const gibiruScraper_1 = require("../crawlers/gibiruScraper");
const preSearchScraper_1 = require("../crawlers/preSearchScraper");
const yepSearchScraper_1 = require("../crawlers/yepSearchScraper");
const aolSearchScraper_1 = require("../crawlers/aolSearchScraper");
const bingSearchScraper_1 = require("../crawlers/bingSearchScraper");
const braveSearchScraper_1 = require("../crawlers/braveSearchScraper");
const duckDuckGoScraper_1 = require("../crawlers/duckDuckGoScraper");
const yahooSearchScraper_1 = require("../crawlers/yahooSearchScraper");
/**
 * SearchManager is responsible for managing multiple search engine scrapers
 * and attempting searches with each until results are found
 */
class SearchManager {
    constructor() {
        this.scrapers = [];
        this.availableScrapers = new Map();
        // Initialize all scrapers
        this.initializeScrapers();
        // Use all available scrapers
        this.scrapers = Array.from(this.availableScrapers.values());
        logger_1.logger.info('SearchManager initialized with scrapers', {
            scraperCount: this.scrapers.length,
            scraperNames: this.getScraperNames()
        });
    }
    /**
     * Get names of currently enabled scrapers
     */
    getScraperNames() {
        return Array.from(this.availableScrapers.keys());
    }
    /**
     * Initialize all available scrapers
     */
    initializeScrapers() {
        // Create instances of all scrapers
        const googleScraper = new googleScraper_1.GoogleScraper();
        const ecosiaScraper = new ecosiaScraper_1.EcosiaScraper();
        const gibiruScraper = new gibiruScraper_1.GibiruScraper();
        const preSearchScraper = new preSearchScraper_1.PreSearchScraper();
        const yepSearchScraper = new yepSearchScraper_1.YepSearchScraper();
        const aolSearchScraper = new aolSearchScraper_1.AolSearchScraper();
        const bingSearchScraper = new bingSearchScraper_1.BingSearchScraper();
        const braveSearchScraper = new braveSearchScraper_1.BraveSearchScraper();
        const duckDuckGoScraper = new duckDuckGoScraper_1.DuckDuckGoScraper();
        const yahooSearchScraper = new yahooSearchScraper_1.YahooSearchScraper();
        // Add them to the available scrapers map with their names
        this.availableScrapers.set('Google', googleScraper);
        this.availableScrapers.set('Ecosia', ecosiaScraper);
        this.availableScrapers.set('Gibiru', gibiruScraper);
        this.availableScrapers.set('AolSearch', aolSearchScraper);
        this.availableScrapers.set('Brave', braveSearchScraper);
        this.availableScrapers.set('DuckDuckGo', duckDuckGoScraper);
        this.availableScrapers.set('Yahoo', yahooSearchScraper);
        // Note: PreSearch is not working, need custom scraper to get results, flare solverr get page result successfully but not get results, need to wait for them to fix it    // this.availableScrapers.set('YepSearch', yepSearchScraper);
        // this.availableScrapers.set('PreSearch', preSearchScraper); 
        // this.availableScrapers.set('Bing', bingSearchScraper);
    }
    /**
     * Enable/disable a specific search engine
     */
    setScraperEnabled(scraperName, enabled) {
        const scraper = this.availableScrapers.get(scraperName);
        if (!scraper) {
            logger_1.logger.warn(`Cannot set enabled state for unknown scraper: ${scraperName}`);
            return;
        }
        if (enabled) {
            // Add to active scrapers if not already there
            if (!this.scrapers.includes(scraper)) {
                this.scrapers.push(scraper);
                logger_1.logger.info(`Enabled scraper: ${scraperName}`);
            }
        }
        else {
            // Remove from active scrapers
            const index = this.scrapers.indexOf(scraper);
            if (index !== -1) {
                this.scrapers.splice(index, 1);
                logger_1.logger.info(`Disabled scraper: ${scraperName}`);
            }
        }
    }
    /**
     * Get a list of all available scrapers with their enabled status
     */
    getScraperStatus() {
        return Array.from(this.availableScrapers.keys()).map(name => {
            const scraper = this.availableScrapers.get(name);
            const enabled = this.scrapers.includes(scraper);
            return {
                name,
                enabled
            };
        });
    }
    /**
     * Main method to search using all available scrapers until results are found
     */
    async search(query, options = {}) {
        logger_1.logger.info(`Starting search with manager for query: ${query}`, {
            options,
            availableScrapers: this.scrapers.length
        });
        if (this.scrapers.length === 0) {
            return {
                query,
                results: [],
                error: 'No scrapers available for search'
            };
        }
        const errors = [];
        // Try each scraper until one succeeds
        for (const scraper of this.scrapers) {
            try {
                const scraperName = Array.from(this.availableScrapers.entries())
                    .find(([_, s]) => s === scraper)?.[0] || 'Unknown';
                logger_1.logger.info(`Attempting search with ${scraperName} for query: ${query}`);
                const startTime = Date.now();
                const results = await scraper.search(query, options);
                const duration = (Date.now() - startTime) / 1000;
                // Check if we got valid results
                if (results.error) {
                    logger_1.logger.warn(`Search with ${scraperName} returned error: ${results.error}`);
                    errors.push(`${scraperName}: ${results.error}`);
                    continue;
                }
                if (!results.results || results.results.length === 0) {
                    logger_1.logger.warn(`Search with ${scraperName} returned no results`);
                    errors.push(`${scraperName}: No results returned`);
                    continue;
                }
                const validResults = results.results.filter(r => 
                    r && r.url && 
                    (r.url.startsWith('http://') || r.url.startsWith('https://')) &&
                    !r.url.startsWith('/') &&
                    !r.url.includes('google.com/search') &&
                    !r.url.includes('google.com/goto')
                );
                if (validResults.length === 0) {
                    logger_1.logger.warn(`Search with ${scraperName} returned no valid external URLs`);
                    errors.push(`${scraperName}: No valid external URLs returned`);
                    continue;
                }
                results.results = validResults;
                // Success! We have results
                logger_1.logger.info(`Successfully got ${results.results.length} results from ${scraperName} in ${duration}s`);
                // Add the source to the results
                return {
                    ...results,
                    source: scraperName
                };
            }
            catch (error) {
                const scraperName = Array.from(this.availableScrapers.entries())
                    .find(([_, s]) => s === scraper)?.[0] || 'Unknown';
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger_1.logger.error(`Error searching with ${scraperName}:`, { error });
                errors.push(`${scraperName}: ${errorMessage}`);
            }
        }
        // If we get here, all scrapers failed, try with proxy as a last resort
        logger_1.logger.warn('All scrapers failed for query, attempting with proxy as fallback', { query });
        try {
            // Import only when needed to avoid circular dependencies
            const { ProxyService } = require('../services/proxyService');
            const proxyService = ProxyService.getInstance();
            // Get a random proxy if available
            const proxy = proxyService.getRandomProxy();
            if (proxy) {
                logger_1.logger.info(`Attempting search with proxy ${proxy.protocol}://${proxy.ip}:${proxy.port}`);
                // Try each scraper again, but with proxy
                for (const scraper of this.scrapers) {
                    try {
                        const scraperName = Array.from(this.availableScrapers.entries())
                            .find(([_, s]) => s === scraper)?.[0] || 'Unknown';
                        logger_1.logger.info(`Attempting search with ${scraperName} using proxy for query: ${query}`);
                        // Add proxy to search options
                        const proxyOptions = {
                            ...options,
                            proxy: proxy
                        };
                        const startTime = Date.now();
                        const results = await scraper.search(query, proxyOptions);
                        const duration = (Date.now() - startTime) / 1000;
                        // Check if we got valid results
                        if (results.error) {
                            logger_1.logger.warn(`Proxy search with ${scraperName} returned error: ${results.error}`);
                            continue;
                        }
                        if (!results.results || results.results.length === 0) {
                            logger_1.logger.warn(`Proxy search with ${scraperName} returned no results`);
                            continue;
                        }
                        const validResults = results.results.filter(r => 
                            r && r.url && 
                            (r.url.startsWith('http://') || r.url.startsWith('https://')) &&
                            !r.url.startsWith('/') &&
                            !r.url.includes('google.com/search') &&
                            !r.url.includes('google.com/goto')
                        );
                        if (validResults.length === 0) {
                            continue;
                        }
                        results.results = validResults;
                        // Success! We have results with proxy
                        logger_1.logger.info(`Successfully got ${results.results.length} results from ${scraperName} with proxy in ${duration}s`);
                        // Add the source and proxy info to the results
                        return {
                            ...results,
                            source: `${scraperName} (proxy)`,
                            usingProxy: true
                        };
                    }
                    catch (error) {
                        const scraperName = Array.from(this.availableScrapers.entries())
                            .find(([_, s]) => s === scraper)?.[0] || 'Unknown';
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        logger_1.logger.error(`Error searching with ${scraperName} using proxy:`, { error });
                    }
                }
            }
            else {
                logger_1.logger.warn('No proxies available for fallback search attempt');
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error('Error attempting proxy fallback:', { error: errorMessage });
            errors.push(`Proxy fallback: ${errorMessage}`);
        }
        // If we get here, all attempts including proxy fallback failed
        logger_1.logger.error('All scrapers and proxy fallback failed for query', { query, errors });
        return {
            query,
            results: [],
            error: `All search engines failed: ${errors.join('; ')}`
        };
    }
    /**
     * Perform health check on all scrapers
     */
    async healthCheck() {
        const results = {};
        let workingScrapers = 0;
        // Check all active scrapers
        for (const scraper of this.scrapers) {
            try {
                const scraperName = Array.from(this.availableScrapers.entries())
                    .find(([_, s]) => s === scraper)?.[0] || 'Unknown';
                const health = await scraper.healthCheck();
                results[scraperName] = health.status === 'ok';
                if (health.status === 'ok') {
                    workingScrapers++;
                }
            }
            catch (error) {
                const scraperName = Array.from(this.availableScrapers.entries())
                    .find(([_, s]) => s === scraper)?.[0] || 'Unknown';
                logger_1.logger.error(`Error checking health of ${scraperName}:`, { error });
                results[scraperName] = false;
            }
        }
        // Determine overall status
        let status = 'down';
        let message;
        if (workingScrapers === this.scrapers.length) {
            status = 'ok';
            message = 'All search engines are operational';
        }
        else if (workingScrapers > 0) {
            status = 'degraded';
            message = `${workingScrapers}/${this.scrapers.length} search engines operational`;
        }
        else {
            status = 'down';
            message = 'All search engines are down';
        }
        return {
            status,
            scrapers: results,
            message
        };
    }
}
exports.SearchManager = SearchManager;
