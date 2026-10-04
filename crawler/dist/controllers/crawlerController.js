"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrawlerController = void 0;
const crawlerService_1 = require("../services/crawlerService");
const logger_1 = require("../utils/logger");
class CrawlerController {
    constructor() {
        /**
         * @swagger
         * /crawl:
         *   post:
         *     summary: Crawl web pages based on a search query
         *     description: Searches the web for results matching the given query and returns the content of those pages
         *     tags: [Crawling]
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             $ref: '#/components/schemas/CrawlRequest'
         *             properties:
         *               query:
         *                 type: string
         *                 description: The search query to crawl for
         *                 required: true
         *               numResults:
         *                 type: integer
         *                 description: Number of results to return
         *                 default: 5
         *               debug:
         *                 type: boolean
         *                 description: When true, include HTML content in the response
         *                 default: true
         *               language:
         *                 type: string
         *                 description: Language code for search results
         *               region:
         *                 type: string
         *                 description: Region code for search results
         *     responses:
         *       200:
         *         description: Successfully crawled web pages
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/CrawlResponse'
         *       400:
         *         description: Missing query parameter
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/Error'
         *       500:
         *         description: Server error
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/Error'
         */
        this.crawl = async (req, res) => {
            const { query } = req.body;
            const options = {
                numResults: req.body.numResults || 5,
                language: req.body.language,
                region: req.body.region,
                filters: req.body.filters,
                debug: req.body.debug !== undefined ? req.body.debug : true,
                removeAllSpaces: req.body.removeAllSpaces,
                removeLineBreaks: req.body.removeLineBreaks,
                collapseSpaces: req.body.collapseSpaces
            };
            if (!query) {
                logger_1.logger.warn('Missing query parameter');
                res.status(400).json({ error: 'Query is required' });
                return;
            }
            try {
                logger_1.logger.info('Received crawl request', { query, options });
                const results = await this.crawlerService.crawl(query, options);
                res.json(results);
            }
            catch (error) {
                logger_1.logger.error('Error processing crawl request', { error, query });
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                res.status(500).json({ error: errorMessage });
            }
        };
        /**
         * @swagger
         * /health:
         *   get:
         *     summary: Check crawler service health
         *     description: Returns the health status of the crawler service and its dependencies
         *     tags: [Health]
         *     responses:
         *       200:
         *         description: Health status (OK or degraded)
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/HealthCheckResponse'
         *       503:
         *         description: Service unavailable
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/HealthCheckResponse'
         */
        this.healthCheck = async (req, res) => {
            try {
                const health = await this.crawlerService.healthCheck();
                if (health.status === 'ok') {
                    res.json({ status: 'ok', details: health });
                }
                else {
                    res.status(health.status === 'down' ? 503 : 200)
                        .json({ status: health.status, details: health });
                }
            }
            catch (error) {
                logger_1.logger.error('Health check error', { error });
                res.status(503).json({
                    status: 'down',
                    error: error instanceof Error ? error.message : 'Unknown error during health check'
                });
            }
        };
        /**
         * @swagger
         * /clean:
         *   post:
         *     summary: Clean and extract content from raw API responses
         *     description: Processes raw API response content into clean, structured data
         *     tags: [Content Processing]
         *     requestBody:
         *       required: true
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             properties:
         *               rawResponse:
         *                 type: object
         *                 description: The raw response object from the API
         *     responses:
         *       200:
         *         description: Successfully cleaned content
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/SearchResponse'
         *       400:
         *         description: Invalid input
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/Error'
         *       500:
         *         description: Server error
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/Error'
         */
        this.cleanContent = async (req, res) => {
            const { results } = req.body;
            if (!results) {
                logger_1.logger.warn('Missing rawResponse parameter');
                res.status(400).json({ error: 'rawResponse is required' });
                return;
            }
            try {
                logger_1.logger.info('Received content cleaning request');
                const cleaningOptions = {
                    removeAllSpaces: req.body.removeAllSpaces,
                    removeLineBreaks: req.body.removeLineBreaks,
                    collapseSpaces: req.body.collapseSpaces
                };
                const cleanedContent = await this.crawlerService.processRawResponse(results, cleaningOptions);
                res.json(cleanedContent);
            }
            catch (error) {
                logger_1.logger.error('Error processing content cleaning request', { error });
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                res.status(500).json({ error: errorMessage });
            }
        };
        /**
         * @swagger
         * /clear-cache:
         *   post:
         *     summary: Clear crawler cache
         *     description: Clear the crawler's Redis cache for specific URLs or patterns
         *     tags: [Cache]
         *     requestBody:
         *       content:
         *         application/json:
         *           schema:
         *             type: object
         *             properties:
         *               url:
         *                 type: string
         *                 description: Optional URL pattern to clear from cache
         *     responses:
         *       200:
         *         description: Cache cleared successfully
         *       500:
         *         description: Server error
         */
        this.clearCache = async (req, res) => {
            try {
                const { url } = req.body;
                await this.crawlerService.clearCache(url);
                res.json({ message: 'Cache cleared successfully' });
            }
            catch (error) {
                logger_1.logger.error('Error clearing cache', { error });
                res.status(500).json({
                    error: error instanceof Error ? error.message : 'Unknown error clearing cache'
                });
            }
        };
        this.crawlerService = new crawlerService_1.CrawlerService();
    }
}
exports.CrawlerController = CrawlerController;
