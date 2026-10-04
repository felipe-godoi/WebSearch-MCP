"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseScraper = void 0;
const flaresolverrClient_1 = require("../services/flaresolverrClient");
const redisService_1 = require("../services/redisService");
const logger_1 = require("../utils/logger");
class BaseScraper {
    constructor(name) {
        // Configuration
        this.config = {
            timeout: 30000, // 30 seconds
            cacheExpiry: 3600 // 1 hour
        };
        this.name = name;
        this.flareClient = new flaresolverrClient_1.FlareSolverrClient();
        this.redisService = redisService_1.RedisService.getInstance();
        logger_1.logger.info(`${this.name}Scraper initialized`, { config: this.config });
    }
    /**
     * Perform a search attempt with proxy fallback if original search fails
     * This is a helper method that can be used by specific scraper implementations
     * @param query The search query
     * @param options Search options
     * @param executeSearch Function that performs the actual search
     */
    async searchWithProxyFallback(query, options, executeSearch) {
        try {
            // Try normal search first
            const results = await executeSearch(query, options);
            // If search was successful with results, return them
            if (!results.error && results.results && results.results.length > 0) {
                return results;
            }
            // If search had an error or returned no results, try with proxy
            logger_1.logger.warn(`${this.name} search failed or returned no results, trying with proxy fallback for query: ${query}`);
            // Only load ProxyService when needed to avoid circular dependencies
            const { ProxyService } = require('../services/proxyService');
            const proxyService = ProxyService.getInstance();
            // Get a random proxy if available
            const proxy = proxyService.getRandomProxy();
            if (proxy) {
                logger_1.logger.info(`Attempting ${this.name} search with proxy ${proxy.protocol}://${proxy.ip}:${proxy.port} for query: ${query}`);
                // Add proxy to search options
                const proxyOptions = {
                    ...options,
                    proxy: proxy
                };
                // Try search with proxy
                const proxyResults = await executeSearch(query, proxyOptions);
                // If we got results with proxy, mark them as such
                if (!proxyResults.error && proxyResults.results && proxyResults.results.length > 0) {
                    logger_1.logger.info(`Successfully got ${proxyResults.results.length} results from ${this.name} with proxy`);
                    return {
                        ...proxyResults,
                        usingProxy: true
                    };
                }
                logger_1.logger.warn(`Proxy search with ${this.name} also failed for query: ${query}`);
            }
            else {
                logger_1.logger.warn(`No proxies available for ${this.name} fallback search attempt`);
            }
            // If we get here, both normal and proxy searches failed, return original results
            return results;
        }
        catch (error) {
            // If there was an exception in our fallback logic, log it and return a proper error result
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`Error in ${this.name} proxy fallback search:`, { error: errorMessage, query });
            return {
                query,
                results: [],
                error: `${this.name} search failed: ${errorMessage}`
            };
        }
    }
    /**
     * Check health of all dependencies
     */
    async healthCheck() {
        const flareSolverrStatus = await this.flareClient.healthCheck();
        const redisStatus = this.redisService.isAvailable();
        let engineStatus = false;
        if (flareSolverrStatus) {
            // Try a simple search to verify connectivity
            try {
                const testQuery = 'test123456789';
                const results = await this.search(testQuery, { numResults: 1 });
                engineStatus = !results.error;
            }
            catch (error) {
                logger_1.logger.error(`Health check ${this.name} test failed`, { error });
            }
        }
        const status = {
            status: flareSolverrStatus && engineStatus ? 'ok' : (flareSolverrStatus ? 'degraded' : 'down'),
            flaresolverr: flareSolverrStatus,
            google: engineStatus, // This will be replaced in each specific scraper
            redis: redisStatus
        };
        if (!flareSolverrStatus) {
            status.message = 'FlareSolverr service is unavailable';
        }
        else if (!engineStatus) {
            status.message = `${this.name} search is not working properly`;
        }
        else if (!redisStatus) {
            status.message = 'Redis is unavailable, using in-memory cache fallback';
            status.status = 'degraded';
        }
        return status;
    }
    /**
     * Update service configuration
     */
    configureService(config) {
        if (config.timeout !== undefined) {
            this.config.timeout = config.timeout;
        }
        if (config.cacheExpiry !== undefined) {
            this.config.cacheExpiry = config.cacheExpiry;
        }
        logger_1.logger.info(`${this.name} scraper configuration updated`, { config: this.config });
    }
    /**
     * Get cached search results
     */
    async getCachedResults(cacheKey) {
        try {
            const cachedData = await this.redisService.get(cacheKey);
            if (cachedData) {
                return JSON.parse(cachedData);
            }
            return null;
        }
        catch (error) {
            logger_1.logger.error('Error getting cached results', { error, cacheKey });
            return null;
        }
    }
    /**
     * Invalidate cache for a specific query or all queries
     */
    async invalidateCache(query, enginePrefix = this.name.toLowerCase()) {
        try {
            if (query) {
                // Delete all cache entries for this query (with different options)
                const pattern = `${enginePrefix}_search:${query}:*`;
                const keys = await this.redisService.keys(pattern);
                if (keys?.length) {
                    await Promise.all(keys.map((key) => this.redisService.del(key)));
                    logger_1.logger.info(`Invalidated cache for query: ${query}`, { engine: this.name });
                }
            }
            else {
                // Delete all keys for this search engine
                const pattern = `${enginePrefix}_search:*`;
                const keys = await this.redisService.keys(pattern);
                if (keys?.length) {
                    await Promise.all(keys.map((key) => this.redisService.del(key)));
                    logger_1.logger.info(`Invalidated all cache entries for ${this.name}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`Error invalidating cache for ${this.name}`, { error, query });
            throw new Error(`Failed to invalidate cache: ${error}`);
        }
    }
    /**
     * Cache search results
     */
    async cacheResults(key, results) {
        try {
            await this.redisService.setex(key, this.config.cacheExpiry, JSON.stringify(results));
            logger_1.logger.debug('Cached search results', { key, engine: this.name });
        }
        catch (error) {
            logger_1.logger.error('Error caching results', { error, key, engine: this.name });
            // We don't throw here to allow the service to continue functioning even if caching fails
        }
    }
    /**
     * Generate cache key from query and options
     */
    getCacheKey(query, options, prefix = this.name.toLowerCase()) {
        // Create a unique key based on query and relevant options
        const optionsKey = JSON.stringify({
            numResults: options.numResults,
            language: options.language,
            region: options.region,
            filters: options.filters
        });
        return `${prefix}_search:${query}:${optionsKey}`;
    }
}
exports.BaseScraper = BaseScraper;
