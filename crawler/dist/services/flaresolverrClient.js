"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlareSolverrClient = void 0;
const logger_1 = require("../utils/logger");
const rotator_1 = require("../utils/rotator");
const httpClient_1 = __importDefault(require("./httpClient"));
class FlareSolverrClient {
    constructor() {
        // Default to localhost:8191 but allow override via environment variable
        this.baseUrl = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
        this.timeout = parseInt(process.env.FLARESOLVERR_TIMEOUT || '60000', 10);
        // Initialize rotator for user agents
        this.rotator = new rotator_1.Rotator();
        logger_1.logger.info(`FlareSolverr client initialized with URL: ${this.baseUrl}`);
    }
    /**
     * Send a GET request to FlareSolverr to get the solution for a URL
     */
    async get(url, options = {}) {
        const request = {
            cmd: 'request.get',
            url,
            maxTimeout: options.maxTimeout || this.timeout,
        };
        if (options.cookies) {
            request.cookies = options.cookies;
        }
        // Add user agent rotation
        request.userAgent = this.rotator.getUserAgent();
        // Add proxy if provided
        if (options.proxy) {
            logger_1.logger.info(`Using proxy for FlareSolverr request: ${options.proxy}`);
            request.proxy = options.proxy;
        }
        try {
            logger_1.logger.debug(`Sending GET request to FlareSolverr: ${url}`);
            const data = await httpClient_1.default.post(this.baseUrl, request, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: this.timeout + 5000, // Give some extra time for the HTTP request itself
                responseType: 'json'
            });
            logger_1.logger.debug(`FlareSolverr response status: ${data.status}`);
            return data;
        }
        catch (error) {
            if (error && typeof error === 'object' && 'response' in error) {
                const err = error;
                logger_1.logger.error(`FlareSolverr request failed: ${err.message}`, {
                    url,
                    status: err.response?.statusCode,
                    data: err.response?.body
                });
                throw new Error(`FlareSolverr request failed: ${err.message}`);
            }
            else {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger_1.logger.error('Unknown error during FlareSolverr request', { error: errorMessage });
                throw new Error('Unknown error during FlareSolverr request');
            }
        }
    }
    /**
     * Send a POST request to FlareSolverr
     */
    async post(url, postData = {}, options = {}) {
        const request = {
            cmd: 'request.post',
            url,
            maxTimeout: options.maxTimeout || this.timeout,
            postData: postData
        };
        if (options.cookies) {
            request.cookies = options.cookies;
        }
        // Add user agent rotation
        request.userAgent = this.rotator.getUserAgent();
        // Add proxy if provided
        if (options.proxy) {
            logger_1.logger.info(`Using proxy for FlareSolverr POST request: ${options.proxy}`);
            request.proxy = options.proxy;
        }
        try {
            logger_1.logger.debug(`Sending POST request to FlareSolverr: ${url}`);
            const data = await httpClient_1.default.post(this.baseUrl, request, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: this.timeout + 5000, // Give some extra time for the HTTP request itself
                responseType: 'json'
            });
            logger_1.logger.debug(`FlareSolverr response status: ${data.status}`);
            return data;
        }
        catch (error) {
            if (error && typeof error === 'object' && 'response' in error) {
                const err = error;
                logger_1.logger.error(`FlareSolverr POST request failed: ${err.message}`, {
                    url,
                    status: err.response?.statusCode,
                    data: err.response?.body
                });
                throw new Error(`FlareSolverr POST request failed: ${err.message}`);
            }
            else {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger_1.logger.error('Unknown error during FlareSolverr POST request', { error: errorMessage });
                throw new Error('Unknown error during FlareSolverr POST request');
            }
        }
    }
    /**
     * Check if FlareSolverr is available and operational
     */
    async healthCheck() {
        try {
            // FlareSolverr doesn't have a dedicated health endpoint, so we use a simple request
            await httpClient_1.default.get(`${this.baseUrl.replace('/v1', '')}/`, {
                timeout: 5000
            });
            return true;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`FlareSolverr health check failed: ${errorMessage}`);
            return false;
        }
    }
}
exports.FlareSolverrClient = FlareSolverrClient;
