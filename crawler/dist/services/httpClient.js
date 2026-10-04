"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = void 0;
const got_1 = __importDefault(require("got"));
const https_proxy_agent_1 = require("https-proxy-agent");
const socks_proxy_agent_1 = require("socks-proxy-agent");
const logger_1 = require("../utils/logger");
/**
 * HttpClient is a wrapper around Got library providing:
 * 1. Consistent error handling
 * 2. Proxy support
 * 3. Timeout handling
 * 4. Abort signal support
 */
class HttpClient {
    constructor(defaultTimeout = 10000) {
        this.defaultTimeout = defaultTimeout;
    }
    /**
     * Make a GET request
     * @param url URL to fetch
     * @param options Request options
     * @returns Response object
     */
    async get(url, options = {}) {
        if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            throw new Error(`Invalid URL: ${url}. URL must be absolute and start with http:// or https://`);
        }
        try {
            const { timeout = this.defaultTimeout, proxy, signal, responseType = 'text' } = options;
            const gotOptions = {
                timeout: { request: timeout },
                responseType,
                throwHttpErrors: true,
                retry: { limit: 0 }
            };
            // Add headers if specified
            if (options.headers) {
                gotOptions.headers = options.headers;
            }
            // Add proxy if specified
            if (proxy) {
                gotOptions.agent = {
                    http: this.createProxyAgent(proxy),
                    https: this.createProxyAgent(proxy)
                };
            }
            // Add abort signal if specified
            if (signal) {
                gotOptions.signal = signal;
            }
            const response = await got_1.default.get(url, gotOptions);
            return response.body;
        }
        catch (error) {
            this.handleError(error, url);
            throw error;
        }
    }
    /**
     * Make a GET request with a cancelable promise
     * @param url URL to fetch
     * @param options Request options
     * @returns Cancelable request
     */
    getCancelable(url, options = {}) {
        if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            throw new Error(`Invalid URL: ${url}. URL must be absolute and start with http:// or https://`);
        }
        const { timeout = this.defaultTimeout, proxy, signal, responseType = 'text' } = options;
        const gotOptions = {
            timeout: { request: timeout },
            responseType,
            throwHttpErrors: true,
            retry: { limit: 0 }
        };
        // Add headers if specified
        if (options.headers) {
            gotOptions.headers = options.headers;
        }
        // Add proxy if specified
        if (proxy) {
            gotOptions.agent = {
                // http: this.createProxyAgent(proxy),
                https: this.createProxyAgent(proxy)
            };
        }
        // Add abort signal if specified
        if (signal) {
            gotOptions.signal = signal;
        }
        return got_1.default.get(url, gotOptions);
    }
    /**
     * Make a POST request
     * @param url URL to fetch
     * @param data Data to send
     * @param options Request options
     * @returns Response object
     */
    async post(url, data, options = {}) {
        if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            throw new Error(`Invalid URL: ${url}. URL must be absolute and start with http:// or https://`);
        }
        try {
            const { timeout = this.defaultTimeout, proxy, signal, responseType = 'json' } = options;
            const gotOptions = {
                timeout: { request: timeout },
                json: data,
                responseType,
                throwHttpErrors: true,
                retry: { limit: 0 }
            };
            // Add headers if specified
            if (options.headers) {
                gotOptions.headers = options.headers;
            }
            // Add proxy if specified
            if (proxy) {
                gotOptions.agent = {
                    http: this.createProxyAgent(proxy),
                    https: this.createProxyAgent(proxy)
                };
            }
            // Add abort signal if specified
            if (signal) {
                gotOptions.signal = signal;
            }
            const response = await got_1.default.post(url, gotOptions);
            return response.body;
        }
        catch (error) {
            this.handleError(error, url);
            throw error;
        }
    }
    /**
     * Create a proxy agent based on protocol
     * @param proxy Proxy to use
     * @returns Proxy agent
     */
    createProxyAgent(proxy) {
        if (proxy.protocol === 'http') {
            return new https_proxy_agent_1.HttpsProxyAgent(`http://${proxy.ip}:${proxy.port}`);
        }
        else if (proxy.protocol === 'socks4' || proxy.protocol === 'socks5') {
            return new socks_proxy_agent_1.SocksProxyAgent(`${proxy.protocol}://${proxy.ip}:${proxy.port}`);
        }
        throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
    }
    /**
     * Handle request errors
     * @param error Error object
     * @param url URL that was being fetched
     */
    handleError(error, url) {
        if (error.name === 'TimeoutError') {
            logger_1.logger.debug(`Request to ${url} timed out`);
        }
        else if (error.name === 'CancelError') {
            logger_1.logger.debug(`Request to ${url} was cancelled`);
        }
        else if (error.response) {
            logger_1.logger.debug(`Request to ${url} failed with status ${error.response.statusCode}: ${error.response.statusMessage}`);
        }
        else {
            logger_1.logger.debug(`Request to ${url} failed: ${error.message}`);
        }
    }
}
exports.HttpClient = HttpClient;
// Export singleton instance
exports.default = new HttpClient();
