"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const redis_1 = __importDefault(require("redis"));
const util_1 = require("util");
const logger_1 = require("../utils/logger");
/**
 * RedisService is a wrapper around the Redis client that provides:
 * 1. Graceful degradation when Redis is unavailable
 * 2. In-memory fallback for critical operations
 * 3. Automatic reconnection attempts
 * 4. Consistent error handling
 *
 * Implemented as a singleton to ensure only one Redis connection is maintained
 */
class RedisService {
    /**
     * Private constructor to enforce singleton pattern
     */
    constructor() {
        this.client = null;
        this.memoryCache = new Map();
        this.isRedisAvailable = false;
        this.reconnectTimer = null;
        this.reconnectInterval = 30000; // 30 seconds
        this.redisUrl = null;
        // Promisified Redis methods
        this.getAsync = null;
        this.setexAsync = null;
        this.delAsync = null;
        this.keysAsync = null;
        // Intentionally empty - initialization happens in initialize()
    }
    /**
     * Get the singleton instance of RedisService
     */
    static getInstance() {
        if (!RedisService.instance) {
            RedisService.instance = new RedisService();
        }
        return RedisService.instance;
    }
    /**
     * Initialize the Redis connection
     * @param redisUrl Redis connection URL
     */
    initialize(redisUrl) {
        // Build Redis URL from environment variables if not provided
        if (!redisUrl) {
            redisUrl = process.env.REDIS_URL;
            if (!redisUrl && process.env.REDIS_HOST) {
                const host = process.env.REDIS_HOST;
                const port = process.env.REDIS_PORT || '6379';
                redisUrl = `redis://${host}:${port}`;
            }
        }
        if (redisUrl) {
            this.redisUrl = redisUrl;
            this.connect(redisUrl);
        }
        else {
            logger_1.logger.warn('No Redis URL provided and none found in environment variables');
        }
    }
    /**
     * Connect to Redis and setup event handlers
     */
    connect(redisUrl) {
        try {
            logger_1.logger.info('Initiating connection to Redis', {
                url: this.sanitizeRedisUrl(redisUrl),
                timestamp: new Date().toISOString()
            });
            logger_1.logger.info('Connecting to Redis', { url: this.sanitizeRedisUrl(redisUrl) });
            this.client = redis_1.default.createClient({ url: redisUrl });
            // Set up event handlers
            this.client.on('connect', () => {
                logger_1.logger.info('Connected to Redis');
            });
            this.client.on('ready', () => {
                this.isRedisAvailable = true;
                logger_1.logger.info('Redis client ready');
                // Clear any reconnect timer if it exists
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                // Promisify Redis methods
                this.getAsync = (0, util_1.promisify)(this.client.get).bind(this.client);
                this.setexAsync = (0, util_1.promisify)(this.client.setex).bind(this.client);
                this.delAsync = (0, util_1.promisify)(this.client.del).bind(this.client);
                this.keysAsync = (0, util_1.promisify)(this.client.keys).bind(this.client);
            });
            this.client.on('error', (err) => {
                const wasAvailable = this.isRedisAvailable;
                this.isRedisAvailable = false;
                logger_1.logger.error('Redis client error', { error: err.message });
                // Only log the fallback message the first time we detect Redis is down
                if (wasAvailable) {
                    logger_1.logger.warn('Redis unavailable, falling back to in-memory cache');
                }
                // Schedule reconnection attempts if not already scheduled
                if (!this.reconnectTimer) {
                    this.reconnectTimer = setTimeout(() => this.reconnect(redisUrl), this.reconnectInterval);
                }
            });
            this.client.on('end', () => {
                this.isRedisAvailable = false;
                logger_1.logger.info('Redis connection closed');
            });
        }
        catch (error) {
            this.isRedisAvailable = false;
            logger_1.logger.error('Failed to initialize Redis client', { error });
        }
    }
    /**
     * Attempt to reconnect to Redis
     */
    reconnect(redisUrl) {
        this.reconnectTimer = null;
        if (this.client) {
            try {
                // Attempt to quit the old client gracefully
                this.client.quit();
            }
            catch (error) {
                logger_1.logger.error('Error closing Redis client during reconnect', { error });
            }
            this.client = null;
        }
        logger_1.logger.info('Attempting to reconnect to Redis');
        this.connect(redisUrl);
    }
    /**
     * Sanitize Redis URL for logging (remove password)
     */
    sanitizeRedisUrl(url) {
        try {
            const parsed = new URL(url);
            if (parsed.password) {
                parsed.password = '***';
            }
            return parsed.toString();
        }
        catch {
            return url.replace(/:\/\/.*@/, '://***@');
        }
    }
    /**
     * Get a value from Redis or memory cache
     */
    async get(key) {
        // Try Redis first if available
        if (this.isRedisAvailable && this.getAsync) {
            try {
                return await this.getAsync(key);
            }
            catch (error) {
                logger_1.logger.error('Redis get operation failed, falling back to memory cache', { error, key });
                this.isRedisAvailable = false;
            }
        }
        // Fallback to memory cache
        const item = this.memoryCache.get(key);
        if (item && item.expiry > Date.now()) {
            return item.value;
        }
        else if (item) {
            // Remove expired items
            this.memoryCache.delete(key);
        }
        return null;
    }
    /**
     * Set a value in Redis or memory cache with expiration
     */
    async setex(key, seconds, value) {
        // Store in memory cache regardless
        this.memoryCache.set(key, {
            value,
            expiry: Date.now() + (seconds * 1000)
        });
        // Try Redis if available
        if (this.isRedisAvailable && this.setexAsync) {
            try {
                await this.setexAsync(key, seconds, value);
            }
            catch (error) {
                logger_1.logger.error('Redis setex operation failed, using memory cache only', { error, key });
                this.isRedisAvailable = false;
            }
        }
    }
    /**
     * Delete a value from Redis and memory cache
     */
    async del(key) {
        // Delete from memory cache
        this.memoryCache.delete(key);
        // Try Redis if available
        if (this.isRedisAvailable && this.delAsync) {
            try {
                await this.delAsync(key);
            }
            catch (error) {
                logger_1.logger.error('Redis del operation failed', { error, key });
                this.isRedisAvailable = false;
            }
        }
    }
    /**
     * Find keys matching a pattern (with fallback for memory cache)
     */
    async keys(pattern) {
        // Try Redis if available
        if (this.isRedisAvailable && this.keysAsync) {
            try {
                return await this.keysAsync(pattern);
            }
            catch (error) {
                logger_1.logger.error('Redis keys operation failed, falling back to memory cache', { error, pattern });
                this.isRedisAvailable = false;
            }
        }
        // Fallback to memory cache pattern matching
        const now = Date.now();
        let results = [];
        // Simple pattern matching for memory cache (supports only "prefix*" patterns)
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            this.memoryCache.forEach((value, key) => {
                if (key.startsWith(prefix) && value.expiry > now) {
                    results.push(key);
                }
            });
        }
        else if (this.memoryCache.has(pattern) && this.memoryCache.get(pattern).expiry > now) {
            // Exact match
            results.push(pattern);
        }
        return results;
    }
    /**
     * Check if Redis is available
     */
    isAvailable() {
        return this.isRedisAvailable;
    }
    /**
     * Get memory cache statistics
     */
    getMemoryCacheStats() {
        const now = Date.now();
        let activeItems = 0;
        this.memoryCache.forEach((item) => {
            if (item.expiry > now) {
                activeItems++;
            }
        });
        return {
            size: this.memoryCache.size,
            activeItems
        };
    }
    /**
     * Clear the memory cache
     */
    clearMemoryCache() {
        this.memoryCache.clear();
        logger_1.logger.info('Memory cache cleared');
    }
    /**
     * Force reconnection to Redis
     */
    reconnectNow() {
        if (this.redisUrl) {
            logger_1.logger.info('Forcing reconnection to Redis');
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            this.reconnect(this.redisUrl);
        }
        else {
            logger_1.logger.error('Cannot reconnect - no Redis URL available');
        }
    }
}
exports.RedisService = RedisService;
