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
exports.ContentExtractor = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readability_1 = require("@mozilla/readability");
const jsdom_1 = require("jsdom");
const logger_1 = require("../utils/logger");
const redisService_1 = require("./redisService");
const httpClient_1 = require("./httpClient");
const rotator_1 = require("../utils/rotator");
const domainErrorTracker_1 = require("./domainErrorTracker");
const domainHelper_1 = require("../utils/domainHelper");
class ContentExtractor {
    constructor(domainTracker) {
        this.redisService = redisService_1.RedisService.getInstance();
        this.httpClient = new httpClient_1.HttpClient();
        this.cacheDir = path.join(process.cwd(), 'cache', 'content');
        this.memoryCache = new Map();
        this.blacklistedDomains = new Set();
        // Create cache directory if it doesn't exist
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
        this.config = {
            cacheExpiry: parseInt(process.env.CONTENT_CACHE_EXPIRY || '86400', 10), // 24 hours
            timeout: parseInt(process.env.CONTENT_FETCH_TIMEOUT || '15000', 10), // 15 seconds
            retries: parseInt(process.env.CONTENT_FETCH_RETRIES || '1', 10),
            cachePrefix: 'content_cache:'
        };
        logger_1.logger.info('ContentExtractor initialized', { config: this.config });
        // Keep rotator for user-agent rotation only
        this.rotator = new rotator_1.Rotator();
        // Initialize domain tracker if not provided
        this.domainTracker = domainTracker || new domainErrorTracker_1.DomainErrorTracker();
    }
    /**
     * Extract content from a URL with caching and error tracking
     * @param url URL to extract content from
     * @param options Options for extraction
     * @returns Extracted content
     */
    async extract(url, options = {}) {
        if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            logger_1.logger.warn(`Invalid or relative URL passed to extract: ${url}`);
            return {
                url: url || '',
                html: '',
                text: '',
                error: 'Invalid URL: Must start with http:// or https://'
            };
        }
        const { bypassCache = false, retryCount = 0, useProxyFallback = true } = options;
        // Check for blacklisted domain first
        const domain = (0, domainHelper_1.extractDomain)(url);
        if (this.domainTracker.isBlacklisted(domain)) {
            logger_1.logger.warn(`Skipping extract for blacklisted domain: ${domain}`);
            return {
                url,
                html: '',
                text: '',
                error: 'Domain is blacklisted due to previous errors'
            };
        }
        // Try to get from cache unless explicitly bypassed
        if (!bypassCache) {
            const cachedResult = await this.getFromCache(url);
            if (cachedResult) {
                logger_1.logger.debug(`Cache hit for URL: ${url}`);
                return cachedResult;
            }
        }
        try {
            // Configure request options with user agent
            const requestConfig = {
                headers: {
                    'User-Agent': this.rotator.getUserAgent(),
                    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                },
                timeout: this.config.timeout
            };
            // Make the request
            const response = await this.httpClient.get(url, requestConfig);
            const dom = new jsdom_1.JSDOM(response, {
                url,
                virtualConsole: new jsdom_1.VirtualConsole()
            });
            const reader = new readability_1.Readability(dom.window.document);
            const article = reader.parse();
            if (!article) {
                throw new Error('Could not parse content');
            }
            // Format result with proper defaults for null values
            const result = {
                url,
                html: article.content,
                text: article.textContent,
                title: article.title,
                excerpt: article.excerpt || undefined,
                siteName: article.siteName || undefined,
                byline: article.byline || undefined
            };
            // Cache the successful result
            await this.cacheResult(url, result);
            return result;
        }
        catch (error) {
            // Implement retry logic with exponential backoff
            if (retryCount < this.config.retries) {
                const delay = Math.pow(2, retryCount) * 1000; // 2^retry * 1000ms
                logger_1.logger.info(`Retrying URL: ${url} (attempt ${retryCount + 1}/${this.config.retries}) in ${delay}ms`);
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, delay));
                // Retry
                return this.extract(url, {
                    bypassCache,
                    retryCount: retryCount + 1,
                    useProxyFallback
                });
            }
            // If all regular attempts failed and proxy fallback is enabled, try with proxy
            if (useProxyFallback && retryCount >= this.config.retries) {
                logger_1.logger.warn(`All regular attempts failed for URL: ${url}, trying with proxy fallback`);
                // try {
                //   // Import ProxyService to avoid circular dependencies
                //   const proxyService = ProxyService.getInstance();
                //   // Get a random proxy if available
                //   const proxy = proxyService.getRandomProxy();
                //   if (proxy) {
                //     logger.info(`Attempting content extraction with proxy ${proxy.protocol}://${proxy.ip}:${proxy.port} for URL: ${url}`);
                //     // Configure request options with proxy and user agent
                //     const proxyRequestConfig: any = {
                //       headers: {
                //         'User-Agent': this.rotator.getUserAgent(),
                //         'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                //         'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                //       },
                //       timeout: this.config.timeout,
                //       proxy: proxy
                //     };
                //     // Make the request with proxy
                //     const proxyResponse = await this.httpClient.get(url, proxyRequestConfig);
                //     const proxyDom = new JSDOM(proxyResponse, {
                //       url,
                //       virtualConsole: new VirtualConsole()
                //     });
                //     const proxyReader = new Readability(proxyDom.window.document);
                //     const proxyArticle = proxyReader.parse() as ReadabilityArticle | null;
                //     if (!proxyArticle) {
                //       throw new Error('Could not parse content with proxy');
                //     }
                //     // Format result with proxy info
                //     const proxyResult: CrawlResult = {
                //       url,
                //       html: proxyArticle.content,
                //       text: proxyArticle.textContent,
                //       title: proxyArticle.title,
                //       excerpt: proxyArticle.excerpt || undefined,
                //       siteName: proxyArticle.siteName || undefined,
                //       byline: proxyArticle.byline || undefined,
                //       usingProxy: true
                //     };
                //     // Cache the successful result
                //     await this.cacheResult(url, proxyResult);
                //     return proxyResult;
                //   } else {
                //     logger.warn('No proxies available for fallback extraction attempt');
                //   }
                // } catch (proxyError) {
                //   const proxyErrorMessage = proxyError instanceof Error ? proxyError.message : 'Unknown proxy error';
                //   logger.error(`Proxy fallback extraction failed for URL: ${url}`, { error: proxyErrorMessage });
                // }
            }
            // Track domain error after all retries are exhausted
            await this.domainTracker.trackError(url);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            logger_1.logger.error(`Failed to extract content after ${this.config.retries} retries: ${url}`, { error: errorMessage });
            return {
                url,
                html: '',
                text: '',
                error: errorMessage
            };
        }
    }
    /**
     * Get content from cache
     * @param url URL to get cached content for
     * @returns Cached content or null if not found
     */
    async getFromCache(url) {
        try {
            // Use the Redis singleton directly
            if (this.redisService.isAvailable()) {
                const cacheKey = this.generateCacheKey(url);
                const cachedData = await this.redisService.get(cacheKey);
                if (cachedData) {
                    return JSON.parse(cachedData);
                }
            }
            return null;
        }
        catch (error) {
            logger_1.logger.warn(`Error getting cached content for URL: ${url}`, { error });
            return null;
        }
    }
    /**
     * Cache extraction result
     * @param url URL to cache content for
     * @param result Content to cache
     */
    async cacheResult(url, result) {
        try {
            // Only cache if Redis is available
            if (this.redisService.isAvailable()) {
                const cacheKey = this.generateCacheKey(url);
                await this.redisService.setex(cacheKey, this.config.cacheExpiry, JSON.stringify(result));
            }
        }
        catch (error) {
            logger_1.logger.warn(`Error caching content for URL: ${url}`, { error });
            // Continue even if caching fails
        }
    }
    /**
     * Generate cache key for a URL
     * @param url URL to generate cache key for
     * @returns Cache key
     */
    generateCacheKey(url) {
        // Use a hash of the URL to prevent issues with special characters
        const urlHash = Buffer.from(url).toString('base64');
        return `${this.config.cachePrefix}${urlHash}`;
    }
    /**
     * Get the current domain blacklist (internal method - not exposed to API)
     * @returns Array of blacklisted domains
     * @internal For internal crawler service use only
     */
    getBlacklistedDomains() {
        return this.domainTracker.getBlacklistedDomains();
    }
    /**
     * Clear content cache for a specific URL or pattern
     * @param urlPattern URL or pattern to clear cache for (use * for wildcard)
     */
    async clearCache(urlPattern) {
        try {
            // Only proceed if Redis is available
            if (this.redisService.isAvailable()) {
                if (!urlPattern) {
                    // Clear all cache if no pattern provided
                    const keys = await this.redisService.keys(`${this.config.cachePrefix}*`);
                    for (const key of keys) {
                        await this.redisService.del(key);
                    }
                    logger_1.logger.info('Cleared all content cache');
                }
                else {
                    // For single URL, calculate its exact cache key
                    const cacheKey = this.generateCacheKey(urlPattern);
                    await this.redisService.del(cacheKey);
                    logger_1.logger.info(`Cleared cache for URL: ${urlPattern}`);
                }
            }
            else {
                logger_1.logger.warn('Redis not available, cache operations skipped');
            }
        }
        catch (error) {
            logger_1.logger.error('Error clearing content cache', { error, urlPattern });
        }
    }
}
exports.ContentExtractor = ContentExtractor;
