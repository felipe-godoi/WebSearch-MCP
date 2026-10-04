"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./utils/logger");
const crawlerController_1 = require("./controllers/crawlerController");
const redisService_1 = require("./services/redisService");
const proxyService_1 = require("./services/proxyService");
// Load environment variables
dotenv_1.default.config();
// Initialize Redis singleton
const redisService = redisService_1.RedisService.getInstance();
redisService.initialize();
logger_1.logger.info('Redis service initialized');
// Initialize ProxyService singleton
const proxyService = proxyService_1.ProxyService.getInstance();
proxyService.initialize()
    .then(() => logger_1.logger.info('Proxy service initialized'))
    .catch(err => logger_1.logger.error(`Failed to initialize Proxy service: ${err.message}`));
const app = (0, express_1.default)();
const crawlerController = new crawlerController_1.CrawlerController();
const port = process.env.PORT || 3002;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Set content type for all responses
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});
// Increase timeout for requests
app.use((req, res, next) => {
    // Set timeout to 5 minutes
    req.setTimeout(300000); // 5 minutes
    res.setTimeout(300000); // 5 minutes
    next();
});
// Root route
app.get('/', (req, res) => {
    logger_1.logger.info('Crawler root endpoint accessed');
    res.json({
        status: 'success',
        message: 'WebSearch API Crawler Service is running',
        version: '1.0.0',
        lastUpdated: new Date().toISOString()
    });
});
// API endpoints for crawling
app.post('/crawl', crawlerController.crawl);
// Content cleaning endpoint
app.post('/clean', crawlerController.cleanContent);
// Cache management endpoint
app.post('/clear-cache', crawlerController.clearCache);
// Health check endpoint
app.get('/health', crawlerController.healthCheck);
// Start the server
app.listen(port, () => {
    logger_1.logger.info(`Crawler service running on port ${port}`);
});
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger_1.logger.error('Uncaught Exception:', error);
    process.exit(1);
});
// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger_1.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
// Handle shutdown gracefully
process.on('SIGINT', () => {
    logger_1.logger.info('Shutting down gracefully...');
    proxyService.shutdown();
    // Redis will handle its own shutdown
    process.exit(0);
});
exports.default = app;
