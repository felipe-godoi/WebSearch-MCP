"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomainErrorTracker = void 0;
const redisService_1 = require("./redisService");
const logger_1 = require("../utils/logger");
const domainHelper_1 = require("../utils/domainHelper");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
/**
 * Service for tracking errors by domain and managing a domain blacklist
 */
class DomainErrorTracker {
    constructor() {
        this.REDIS_PREFIX = "domain_errors:";
        this.BLACKLIST_KEY = "domain_blacklist";
        this.ERROR_THRESHOLD = 5;
        this.ERROR_TTL = 86400 * 30; // 30 days expiry for error counts
        // File backup paths
        this.STORAGE_DIR = path_1.default.join(__dirname, "../../storage");
        this.BLACKLIST_FILE = path_1.default.join(__dirname, "../../storage/domain_blacklist.json");
        this.ERROR_COUNTS_FILE = path_1.default.join(__dirname, "../../storage/domain_error_counts.json");
        // In-memory cache of blacklisted domains (to reduce Redis reads)
        this.blacklistedDomains = new Set();
        this.errorCounts = new Map();
        this.blacklistLoaded = false;
        // Debouncing variables for file persistence
        this.errorCountsPersistTimer = null;
        this.errorCountsNeedsPersist = false;
        // Get the singleton instance of RedisService
        this.redisService = redisService_1.RedisService.getInstance();
        this.initializeStorage()
            .then(() => this.loadBlacklist())
            .then(() => this._blacklistKnownProblematicDomains());
    }
    /**
     * Initialize storage for file-based fallback
     */
    async initializeStorage() {
        try {
            await promises_1.default.mkdir(this.STORAGE_DIR, { recursive: true });
            logger_1.logger.info("Domain error tracker storage directory initialized");
        }
        catch (error) {
            logger_1.logger.error("Failed to initialize domain error tracker storage directory", { error });
        }
    }
    /**
     * Load the blacklist from Redis into memory
     */
    async loadBlacklist() {
        try {
            // Try Redis first
            const redisBlacklist = await this.redisService.get(this.BLACKLIST_KEY);
            if (redisBlacklist) {
                const domains = JSON.parse(redisBlacklist);
                this.blacklistedDomains = new Set(domains);
                this.blacklistLoaded = true;
                logger_1.logger.info(`Loaded domain blacklist from Redis with ${this.blacklistedDomains.size} domains`);
                return;
            }
        }
        catch (error) {
            logger_1.logger.error("Failed to load domain blacklist from Redis", { error });
        }
        finally {
            await this.loadBlacklistFromFile();
        }
    }
    /**
     * Load blacklist from file as fallback
     */
    async loadBlacklistFromFile() {
        try {
            logger_1.logger.info(`Loading domain blacklist from file: ${this.BLACKLIST_FILE}`);
            const fileExists = await this.fileExists(this.BLACKLIST_FILE);
            if (fileExists) {
                console.log("File exists", this.BLACKLIST_FILE);
                const data = await promises_1.default.readFile(this.BLACKLIST_FILE, "utf8");
                try {
                    const domains = JSON.parse(data);
                    if (Array.isArray(domains)) {
                        this.blacklistedDomains = new Set(domains);
                        logger_1.logger.info(`Loaded domain blacklist from file with ${this.blacklistedDomains.size} domains`);
                    }
                    else {
                        logger_1.logger.error("Invalid domain blacklist format in file, expected an array");
                        this.blacklistedDomains = new Set();
                    }
                }
                catch (parseError) {
                    logger_1.logger.error("Failed to parse domain blacklist JSON", {
                        error: parseError,
                        data,
                    });
                    this.blacklistedDomains = new Set();
                }
            }
            else {
                this.blacklistedDomains = new Set();
                logger_1.logger.info("No domain blacklist file found, starting with empty blacklist");
            }
            // Also load error counts from file if available
            await this.loadErrorCountsFromFile();
            this.blacklistLoaded = true;
        }
        catch (error) {
            logger_1.logger.error("Failed to load domain blacklist from file", { error });
            this.blacklistedDomains = new Set();
            this.blacklistLoaded = true; // Mark as loaded even on error to prevent constant retries
        }
    }
    /**
     * Load error counts from file as fallback
     */
    async loadErrorCountsFromFile() {
        try {
            const fileExists = await this.fileExists(this.ERROR_COUNTS_FILE);
            if (fileExists) {
                const data = await promises_1.default.readFile(this.ERROR_COUNTS_FILE, "utf8");
                const counts = JSON.parse(data);
                this.errorCounts = new Map(Object.entries(counts));
                logger_1.logger.info(`Loaded domain error counts from file for ${this.errorCounts.size} domains`);
            }
            else {
                this.errorCounts = new Map();
                logger_1.logger.info("No domain error counts file found, starting with empty counts");
            }
        }
        catch (error) {
            logger_1.logger.error("Failed to load domain error counts from file", { error });
            this.errorCounts = new Map();
        }
    }
    /**
     * Utility to check if a file exists
     */
    async fileExists(filePath) {
        try {
            await promises_1.default.access(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Track an error for a domain and optionally blacklist if threshold exceeded
     * @param url URL that experienced an error
     * @returns Whether the domain was blacklisted as a result
     */
    async trackError(url) {
        const domain = (0, domainHelper_1.extractDomain)(url);
        if (!domain || domain.length < 3) {
            return false; // Ignore invalid domains
        }
        // Check if already blacklisted
        if (this.isBlacklisted(domain)) {
            return true;
        }
        const key = `${this.REDIS_PREFIX}${domain}`;
        let count = 1;
        // Try to update count in Redis first
        if (this.redisService.isAvailable()) {
            try {
                // Get current error count
                const countStr = await this.redisService.get(key);
                count = countStr ? parseInt(countStr, 10) + 1 : 1;
                // Update error count with TTL
                await this.redisService.setex(key, this.ERROR_TTL, count.toString());
                logger_1.logger.debug(`Domain error tracked in Redis for ${domain}, count: ${count}`);
            }
            catch (error) {
                logger_1.logger.error("Error tracking domain failure in Redis", {
                    error,
                    domain,
                });
                // Fall back to in-memory/file tracking
                count = this.updateErrorCountInMemory(domain);
            }
        }
        else {
            // Redis not available, use in-memory tracking
            count = this.updateErrorCountInMemory(domain);
        }
        // Check if threshold reached
        if (count >= this.ERROR_THRESHOLD) {
            await this.blacklistDomain(domain);
            logger_1.logger.info(`Domain blacklisted: ${domain} (error count: ${count})`);
            return true;
        }
        return false;
    }
    /**
     * Update error count in memory and persist to file
     * @param domain Domain to update error count for
     * @returns New error count
     */
    updateErrorCountInMemory(domain) {
        const currentCount = this.errorCounts.get(domain) || 0;
        const newCount = currentCount + 1;
        this.errorCounts.set(domain, newCount);
        // Schedule file persistence (debounced)
        this.persistErrorCountsToFile();
        logger_1.logger.debug(`Domain error tracked in memory for ${domain}, count: ${newCount}`);
        return newCount;
    }
    /**
     * Persist error counts to file (debounced)
     */
    persistErrorCountsToFile() {
        this.errorCountsNeedsPersist = true;
        if (!this.errorCountsPersistTimer) {
            this.errorCountsPersistTimer = setTimeout(async () => {
                this.errorCountsPersistTimer = null;
                if (this.errorCountsNeedsPersist) {
                    this.errorCountsNeedsPersist = false;
                    try {
                        const countObject = Object.fromEntries(this.errorCounts);
                        await promises_1.default.writeFile(this.ERROR_COUNTS_FILE, JSON.stringify(countObject, null, 2), "utf8");
                        logger_1.logger.debug("Persisted domain error counts to file");
                    }
                    catch (error) {
                        logger_1.logger.error("Failed to persist domain error counts to file", {
                            error,
                        });
                    }
                }
            }, 5000); // Debounce for 5 seconds
        }
    }
    /**
     * Add a domain to the blacklist
     * @param domain Domain to blacklist
     */
    async blacklistDomain(domain) {
        // Add to in-memory cache
        this.blacklistedDomains.add(domain);
        // Persist to Redis if available
        if (this.redisService.isAvailable()) {
            try {
                const blacklist = Array.from(this.blacklistedDomains);
                await this.redisService.setex(this.BLACKLIST_KEY, 365 * 86400, // 1 year expiry
                JSON.stringify(blacklist));
                logger_1.logger.debug("Domain blacklist persisted to Redis");
            }
            catch (error) {
                logger_1.logger.error("Failed to persist domain blacklist to Redis", { error });
                // Fall back to file persistence
                await this.persistBlacklistToFile();
            }
        }
        await this.persistBlacklistToFile();
    }
    /**
     * Persist the blacklist to a file
     */
    async persistBlacklistToFile() {
        try {
            const blacklist = Array.from(this.blacklistedDomains);
            await promises_1.default.writeFile(this.BLACKLIST_FILE, JSON.stringify(blacklist, null, 2), "utf8");
            logger_1.logger.debug("Domain blacklist persisted to file");
        }
        catch (error) {
            logger_1.logger.error("Failed to persist domain blacklist to file", { error });
        }
    }
    /**
     * Check if a domain is blacklisted
     * @param domainOrUrl Domain or URL to check
     * @returns True if domain is blacklisted
     */
    isBlacklisted(domainOrUrl) {
        if (!this.blacklistLoaded) {
            return false; // Don't block if blacklist isn't loaded yet
        }
        const domain = domainOrUrl.includes("://")
            ? (0, domainHelper_1.extractDomain)(domainOrUrl)
            : domainOrUrl;
        return this.blacklistedDomains.has(domain);
    }
    /**
     * Get all blacklisted domains
     * @returns Array of blacklisted domains
     */
    getBlacklistedDomains() {
        return Array.from(this.blacklistedDomains);
    }
    /**
     * Remove a domain from the blacklist
     * @param domain Domain to remove from blacklist
     */
    async removeFromBlacklist(domain) {
        if (this.blacklistedDomains.has(domain)) {
            // Remove from in-memory set
            this.blacklistedDomains.delete(domain);
            // Update Redis if available
            if (this.redisService.isAvailable()) {
                try {
                    const blacklist = Array.from(this.blacklistedDomains);
                    await this.redisService.setex(this.BLACKLIST_KEY, 365 * 86400, // 1 year expiry
                    JSON.stringify(blacklist));
                    // Also delete any error counts
                    await this.redisService.del(`${this.REDIS_PREFIX}${domain}`);
                    logger_1.logger.info(`Domain removed from blacklist in Redis: ${domain}`);
                }
                catch (error) {
                    logger_1.logger.error("Failed to update domain blacklist in Redis after removal", { error });
                    // Fall back to file persistence
                    await this.persistBlacklistToFile();
                }
            }
            else {
                // Redis not available, use file persistence
                await this.persistBlacklistToFile();
            }
            // Remove from error counts too
            this.errorCounts.delete(domain);
            this.persistErrorCountsToFile();
            logger_1.logger.info(`Domain removed from blacklist: ${domain}`);
        }
    }
    async _blacklistKnownProblematicDomains() {
        // Add known problematic domains to the blacklist
        const problematicDomains = [
            "youtube.com", // Contains dynamic content, player
            "twitter.com", // Prevents scraping
            "facebook.com", // Prevents scraping
            "instagram.com", // Prevents scraping
            "pinterest.com", // Heavy JavaScript, poor content extraction
            "medium.com", // Paywall, authentication required
            "tiktok.com", // Heavy JavaScript, poor content extraction
            "reddit.com", // Some pages require authentication
            "quora.com", // Some content requires login
        ];
        for (const domain of problematicDomains) {
            await this.blacklistDomain(domain);
        }
    }
    /**
     * Clear the entire domain blacklist
     */
    async clearBlacklist() {
        this.blacklistedDomains.clear();
        // Clear in Redis if available
        if (this.redisService.isAvailable()) {
            try {
                await this.redisService.setex(this.BLACKLIST_KEY, 365 * 86400, // 1 year expiry
                JSON.stringify([]));
                logger_1.logger.info("Domain blacklist cleared in Redis");
            }
            catch (error) {
                logger_1.logger.error("Failed to clear domain blacklist in Redis", { error });
            }
        }
        // Always update file backup
        try {
            await promises_1.default.writeFile(this.BLACKLIST_FILE, JSON.stringify([]), "utf8");
            logger_1.logger.info("Domain blacklist cleared in file");
        }
        catch (error) {
            logger_1.logger.error("Failed to clear domain blacklist in file", { error });
        }
    }
    /**
     * Check if Redis is available
     */
    isRedisAvailable() {
        return this.redisService.isAvailable();
    }
}
exports.DomainErrorTracker = DomainErrorTracker;
