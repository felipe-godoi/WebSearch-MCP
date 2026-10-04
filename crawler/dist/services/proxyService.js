"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyService = void 0;
const logger_1 = require("../utils/logger");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const httpClient_1 = __importDefault(require("./httpClient"));
/**
 * @class ProxyService
 * @description Service for managing and rotating proxies
 * - Fetches proxy lists from multiple external sources
 * - Tests proxies for availability and performance
 * - Maintains a list of working proxies
 * - Supports HTTP, SOCKS4, and SOCKS5 proxies
 */
class ProxyService {
    constructor() {
        this.proxyList = [];
        this.availableProxies = [];
        // Array of proxy list URLs
        this.proxyUrls = [
            'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.txt'
        ];
        this.refreshInterval = null;
        this.testTimeout = 2000; // 2 seconds timeout for proxy testing
        this.proxyRefreshInterval = 60 * 60 * 1000; // 1 hour
        this.proxyStorageFile = path_1.default.join(process.cwd(), 'storage', 'proxies.json');
    }
    /**
     * Get singleton instance of ProxyService
     * @returns {ProxyService} The singleton instance
     */
    static getInstance() {
        if (!ProxyService.instance) {
            ProxyService.instance = new ProxyService();
        }
        return ProxyService.instance;
    }
    /**
     * Initialize the proxy service
     * @param {number} refreshIntervalMs - How often to refresh the proxy list (in ms)
     */
    async initialize(refreshIntervalMs = this.proxyRefreshInterval) {
        this.proxyRefreshInterval = refreshIntervalMs;
        try {
            // Try to load proxies from storage first
            await this.loadProxiesFromStorage();
            // Initial fetch and test of proxies
            await this.refreshProxyList();
            // Set up interval for regular refreshes
            this.refreshInterval = setInterval(() => {
                this.refreshProxyList().catch((err) => {
                    logger_1.logger.error(`Failed to refresh proxy list: ${err.message}`);
                });
            }, this.proxyRefreshInterval);
            logger_1.logger.info('ProxyService initialized successfully');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`Failed to initialize ProxyService: ${errorMessage}`);
            throw error;
        }
    }
    /**
     * Load proxies from storage file
     */
    async loadProxiesFromStorage() {
        try {
            // Check if the storage file exists
            if (!fs_1.default.existsSync(this.proxyStorageFile)) {
                logger_1.logger.info(`No proxy storage file found at ${this.proxyStorageFile}`);
                return;
            }
            // Read the file
            const data = await fs_1.default.promises.readFile(this.proxyStorageFile, 'utf8');
            const storedData = JSON.parse(data);
            if (!storedData || !Array.isArray(storedData.proxies) || storedData.proxies.length === 0) {
                logger_1.logger.info('No valid proxies found in storage file');
                return;
            }
            // Convert timestamp strings back to Date objects
            const proxies = storedData.proxies.map((proxy) => ({
                ...proxy,
                lastChecked: proxy.lastChecked ? new Date(proxy.lastChecked) : undefined
            }));
            this.availableProxies = proxies;
            logger_1.logger.info(`Loaded ${proxies.length} proxies from storage file`);
            // Log some stats about the loaded proxies
            const protocolCounts = {
                http: 0,
                socks4: 0,
                socks5: 0
            };
            proxies.forEach(proxy => {
                protocolCounts[proxy.protocol] = (protocolCounts[proxy.protocol] || 0) + 1;
            });
            logger_1.logger.info('Loaded proxies by protocol: ' +
                Object.entries(protocolCounts)
                    .map(([protocol, count]) => `${protocol}: ${count}`)
                    .join(', '));
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`Failed to load proxies from storage: ${errorMessage}`);
            // Don't throw here, just continue with an empty list
        }
    }
    /**
     * Save proxies to storage file
     */
    async saveProxiesToStorage() {
        try {
            if (this.availableProxies.length === 0) {
                logger_1.logger.info('No proxies to save to storage');
                return;
            }
            // Ensure the storage directory exists
            const storageDir = path_1.default.dirname(this.proxyStorageFile);
            if (!fs_1.default.existsSync(storageDir)) {
                await fs_1.default.promises.mkdir(storageDir, { recursive: true });
            }
            // Save the proxies to file
            const dataToSave = {
                timestamp: new Date().toISOString(),
                proxies: this.availableProxies
            };
            await fs_1.default.promises.writeFile(this.proxyStorageFile, JSON.stringify(dataToSave, null, 2), 'utf8');
            logger_1.logger.info(`Saved ${this.availableProxies.length} proxies to ${this.proxyStorageFile}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`Failed to save proxies to storage: ${errorMessage}`);
        }
    }
    /**
     * Fetch the latest proxy list and test all proxies
     */
    async refreshProxyList() {
        try {
            logger_1.logger.info('Refreshing proxy list...');
            // Clear current proxy list
            this.proxyList = [];
            // Fetch and parse proxies from all sources
            for (const url of this.proxyUrls) {
                try {
                    const rawProxies = await this.fetchProxyList(url);
                    const parsedProxies = this.parseProxyList(rawProxies);
                    this.proxyList = [...this.proxyList, ...parsedProxies];
                    logger_1.logger.info(`Added ${parsedProxies.length} proxies from ${url}`);
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    logger_1.logger.error(`Failed to fetch proxies from ${url}: ${errorMessage}`);
                    // Continue with other sources even if one fails
                }
            }
            // Test all proxies and update available list
            await this.testAllProxies();
            // Generate and log proxy report
            this.generateProxyReport();
            // Save proxies to storage file for persistence
            await this.saveProxiesToStorage();
            logger_1.logger.info(`Proxy list refreshed. Total: ${this.proxyList.length}, Available: ${this.availableProxies.length}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`Error refreshing proxy list: ${errorMessage}`);
            throw error;
        }
    }
    /**
     * Fetch raw proxy list from external source
     * @param {string} url - URL to fetch proxy list from
     * @returns {Promise<string>} Raw proxy data
     */
    async fetchProxyList(url) {
        try {
            logger_1.logger.info(`Fetching proxy list from ${url}`);
            const data = await httpClient_1.default.get(url, {
                timeout: 10000 // 10 seconds timeout
            });
            // Check if response data is valid
            if (!data || typeof data !== 'string') {
                logger_1.logger.error(`Invalid proxy list data from ${url}: not a string`);
                return '';
            }
            const trimmedData = data.trim();
            // Basic validation check - make sure it contains proper patterns
            if (!trimmedData.includes('://') && !trimmedData.includes(':')) {
                logger_1.logger.error(`Invalid proxy list data from ${url}: does not contain proxy patterns`);
                logger_1.logger.debug(`Data sample: ${trimmedData.substring(0, 100)}...`);
                return '';
            }
            logger_1.logger.info(`Fetched raw proxy data from ${url}, size: ${trimmedData.length} bytes`);
            return trimmedData;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`Failed to fetch proxy list from ${url}: ${errorMessage}`);
            if (error && typeof error === 'object' && 'response' in error) {
                const errorObj = error;
                if (errorObj.response) {
                    logger_1.logger.error(`Status code: ${errorObj.response.statusCode}, message: ${errorObj.response.statusMessage}`);
                }
            }
            throw error;
        }
    }
    /**
     * Parse raw proxy list into structured Proxy objects
     * @param {string} rawData - Raw proxy data in text format
     * @returns {Proxy[]} Parsed proxies
     */
    parseProxyList(rawData) {
        try {
            const lines = rawData.trim().split('\n');
            logger_1.logger.info(`Parsing ${lines.length} proxy entries`);
            const parsedProxies = lines.map(line => {
                line = line.trim();
                // Determine protocol and extract address
                let protocol = 'http'; // Default to HTTP
                let urlPart = line;
                if (line.startsWith('http://')) {
                    protocol = 'http';
                    urlPart = line.substring(7);
                }
                else if (line.startsWith('socks4://')) {
                    protocol = 'socks4';
                    urlPart = line.substring(9);
                }
                else if (line.startsWith('socks5://')) {
                    protocol = 'socks5';
                    urlPart = line.substring(9);
                }
                // Split into IP and port
                const [ip, portStr] = urlPart.split(':');
                const port = parseInt(portStr, 10);
                return {
                    ip,
                    port,
                    protocol,
                    isAlive: false, // Will be determined by testing
                    lastChecked: undefined
                };
            }).filter(proxy => !isNaN(proxy.port));
            logger_1.logger.info(`Successfully parsed ${parsedProxies.length} valid proxies`);
            // Log the first 5 proxies as samples
            if (parsedProxies.length > 0) {
                logger_1.logger.info('Sample proxies: ' +
                    parsedProxies.slice(0, 5).map(p => `${p.protocol}://${p.ip}:${p.port}`).join(', '));
            }
            return parsedProxies;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger_1.logger.error(`Failed to parse proxy list: ${errorMessage}`);
            return [];
        }
    }
    /**
     * Test all proxies in the list and update the available proxies
     */
    async testAllProxies() {
        logger_1.logger.info(`Testing ${this.proxyList.length} proxies for availability...`);
        // Process proxies in batches to avoid overwhelming the system
        const batchSize = 50; // Test 50 proxies at a time
        const results = [];
        // Process in batches (up to 1000 candidates or until 25 working proxies found)
        const maxTestCount = Math.min(this.proxyList.length, 1000);
        for (let i = 0; i < maxTestCount; i += batchSize) {
            const batch = this.proxyList.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(proxy => this.testProxy(proxy)));
            results.push(...batchResults);
            if (results.filter(r => r.isAlive).length >= 25) {
                logger_1.logger.info(`Found enough working proxies (${results.filter(r => r.isAlive).length}), stopping test early`);
                break;
            }
        }
        // Filter and sort the results
        const workingProxies = results
            .filter(result => result.isAlive)
            .map(result => result.proxy)
            // Sort by latency (faster first)
            .sort((a, b) => (a.latency || Infinity) - (b.latency || Infinity));
        // Group by protocol for logging
        const protocolCounts = {
            http: 0,
            socks4: 0,
            socks5: 0
        };
        workingProxies.forEach(proxy => {
            protocolCounts[proxy.protocol] = (protocolCounts[proxy.protocol] || 0) + 1;
        });
        this.availableProxies = workingProxies;
        logger_1.logger.info(`Proxy testing completed. Found ${workingProxies.length} working proxies out of ${this.proxyList.length}`);
        logger_1.logger.info('Working proxies by protocol: ' +
            Object.entries(protocolCounts)
                .map(([protocol, count]) => `${protocol}: ${count}`)
                .join(', '));
    }
    /**
     * Test a single proxy for availability and performance
     * @param {Proxy} proxy - The proxy to test
     * @returns {Promise<ProxyTestResult>} Test result
     */
    async testProxy(proxy) {
        const testUrl = 'https://www.google.com'; // URL to test against
        const startTime = Date.now();
        const controller = new AbortController();
        let timeoutId = null;
        try {
            // Create a promise that rejects on timeout
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    controller.abort(); // Abort the request when timeout occurs
                    reject(new Error(`Proxy test timed out after ${this.testTimeout}ms`));
                }, this.testTimeout);
            });
            // Create the actual request promise
            const requestPromise = httpClient_1.default.getCancelable(testUrl, {
                timeout: this.testTimeout,
                proxy: proxy,
                signal: controller.signal
            });
            // Race the request against the timeout
            await Promise.race([requestPromise, timeoutPromise]);
            // If we got here, request succeeded before timeout
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            const latency = Date.now() - startTime;
            // Double-check that latency doesn't exceed our timeout (should not happen)
            if (latency > this.testTimeout) {
                // Cap the latency at the timeout value to be safe
                const cappedLatency = Math.min(latency, this.testTimeout);
                return {
                    proxy: {
                        ...proxy,
                        isAlive: true,
                        latency: cappedLatency,
                        lastChecked: new Date()
                    },
                    isAlive: true,
                    latency: cappedLatency
                };
            }
            return {
                proxy: {
                    ...proxy,
                    isAlive: true,
                    latency,
                    lastChecked: new Date()
                },
                isAlive: true,
                latency
            };
        }
        catch (error) {
            // Clear timeout if it exists
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            // Make sure request is aborted
            if (controller && !controller.signal.aborted) {
                controller.abort();
            }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                proxy: {
                    ...proxy,
                    isAlive: false,
                    lastChecked: new Date()
                },
                isAlive: false,
                error: errorMessage
            };
        }
    }
    /**
     * Get a random available proxy
     * @param {string[]} protocols - Optional list of protocols to filter by (e.g., ['http', 'socks5'])
     * @returns {Proxy|null} A random available proxy or null if none available
     */
    getRandomProxy(protocols) {
        let filteredProxies = this.availableProxies;
        // Filter by protocol if specified
        if (protocols && protocols.length > 0) {
            filteredProxies = filteredProxies.filter(p => protocols.includes(p.protocol));
        }
        if (filteredProxies.length === 0) {
            return null;
        }
        const randomIndex = Math.floor(Math.random() * filteredProxies.length);
        return filteredProxies[randomIndex];
    }
    /**
     * Get the fastest available proxy based on latency
     * @param {string[]} protocols - Optional list of protocols to filter by (e.g., ['http', 'socks5'])
     * @returns {Proxy|null} The fastest available proxy or null if none available
     */
    getFastestProxy(protocols) {
        let filteredProxies = this.availableProxies;
        // Filter by protocol if specified
        if (protocols && protocols.length > 0) {
            filteredProxies = filteredProxies.filter(p => protocols.includes(p.protocol));
        }
        if (filteredProxies.length === 0) {
            return null;
        }
        // The proxies are already sorted by latency
        return filteredProxies[0];
    }
    /**
     * Get all available proxies
     * @param {string[]} protocols - Optional list of protocols to filter by (e.g., ['http', 'socks5'])
     * @returns {Proxy[]} List of all available proxies
     */
    getAvailableProxies(protocols) {
        let filteredProxies = [...this.availableProxies];
        // Filter by protocol if specified
        if (protocols && protocols.length > 0) {
            filteredProxies = filteredProxies.filter(p => protocols.includes(p.protocol));
        }
        return filteredProxies;
    }
    /**
     * Get the count of available proxies
     * @param {string[]} protocols - Optional list of protocols to filter by
     * @returns {number} Number of available proxies
     */
    getAvailableProxyCount(protocols) {
        if (protocols && protocols.length > 0) {
            return this.availableProxies.filter(p => protocols.includes(p.protocol)).length;
        }
        return this.availableProxies.length;
    }
    /**
     * Shutdown the proxy service and clear intervals
     */
    shutdown() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        logger_1.logger.info('ProxyService shut down');
    }
    /**
     * Get a detailed report about the current proxy list
     * @returns The proxy report as an object
     */
    getProxyReport() {
        if (this.proxyList.length === 0) {
            return {
                timestamp: new Date().toISOString(),
                summary: {
                    totalProxies: 0,
                    availableProxies: 0,
                    availabilityRate: '0%',
                    latency: {
                        average: 'N/A',
                        min: 'N/A',
                        max: 'N/A'
                    }
                },
                protocolDistribution: {
                    http: 0,
                    socks4: 0,
                    socks5: 0
                },
                networkDistribution: {},
                fastestProxy: 'None available'
            };
        }
        // Calculate statistics
        const totalProxies = this.proxyList.length;
        const availableProxies = this.availableProxies.length;
        const availabilityRate = totalProxies > 0 ? (availableProxies / totalProxies * 100).toFixed(2) : '0';
        // Calculate latency statistics if available
        let avgLatency = 'N/A';
        let minLatency = 'N/A';
        let maxLatency = 'N/A';
        if (availableProxies > 0) {
            const latencies = this.availableProxies
                .map(proxy => proxy.latency || 0)
                .filter(latency => latency > 0);
            if (latencies.length > 0) {
                const sum = latencies.reduce((a, b) => a + b, 0);
                avgLatency = (sum / latencies.length).toFixed(2) + 'ms';
                minLatency = Math.min(...latencies) + 'ms';
                maxLatency = Math.max(...latencies) + 'ms';
            }
        }
        // Group proxies by protocol
        const protocolDistribution = {
            http: 0,
            socks4: 0,
            socks5: 0
        };
        this.availableProxies.forEach(proxy => {
            protocolDistribution[proxy.protocol] = (protocolDistribution[proxy.protocol] || 0) + 1;
        });
        // Group proxies by first octet of IP for network distribution
        const networkDistribution = {};
        this.availableProxies.forEach(proxy => {
            const firstOctet = proxy.ip.split('.')[0];
            networkDistribution[firstOctet] = (networkDistribution[firstOctet] || 0) + 1;
        });
        // Create report
        return {
            timestamp: new Date().toISOString(),
            summary: {
                totalProxies,
                availableProxies,
                availabilityRate: `${availabilityRate}%`,
                latency: {
                    average: avgLatency,
                    min: minLatency,
                    max: maxLatency
                }
            },
            protocolDistribution,
            networkDistribution,
            fastestProxy: this.availableProxies.length > 0 ?
                `${this.availableProxies[0].protocol}://${this.availableProxies[0].ip}:${this.availableProxies[0].port} (${this.availableProxies[0].latency}ms)` :
                'None available'
        };
    }
    /**
     * Generate a detailed report about the current proxy list
     */
    generateProxyReport() {
        if (this.proxyList.length === 0) {
            logger_1.logger.info('Proxy Report: No proxies in the list');
            return;
        }
        // Get the report
        const report = this.getProxyReport();
        // Log the report
        logger_1.logger.info('=== PROXY SERVICE REPORT ===');
        logger_1.logger.info(JSON.stringify(report, null, 2));
        logger_1.logger.info('===========================');
    }
}
exports.ProxyService = ProxyService;
