"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.swaggerSpec = void 0;
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const package_json_1 = require("../../package.json");
/**
 * Swagger configuration options
 */
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'WebSearch API - Crawler Service',
            version: package_json_1.version,
            description: 'API documentation for the WebSearch API crawler service',
            license: {
                name: 'ISC',
                url: 'https://opensource.org/licenses/ISC',
            },
            contact: {
                name: 'WebSearch API Support',
                url: 'https://github.com/yourusername/WebSearchAPI',
                email: 'support@example.com',
            },
        },
        servers: [
            {
                url: '/',
                description: 'Development server',
            },
            {
                url: 'https://crawler.example.com',
                description: 'Production server',
            },
        ],
        components: {
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string', example: 'Error message' },
                    },
                },
                CrawlRequest: {
                    type: 'object',
                    required: ['query'],
                    properties: {
                        query: {
                            type: 'string',
                            example: 'artificial intelligence'
                        },
                        numResults: {
                            type: 'integer',
                            example: 5,
                            description: 'Maximum number of results to return'
                        },
                        language: {
                            type: 'string',
                            example: 'en',
                            description: 'Language code for search results'
                        },
                        region: {
                            type: 'string',
                            example: 'us',
                            description: 'Region code for search results'
                        },
                        filters: {
                            type: 'object',
                            properties: {
                                excludeDomains: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    example: ['youtube.com', 'facebook.com'],
                                    description: 'Domains to exclude from results'
                                },
                                includeDomains: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    example: ['example.com', 'blog.example.com'],
                                    description: 'Only include these domains in results'
                                },
                                excludeTerms: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    example: ['video', 'course'],
                                    description: 'Terms to exclude from results'
                                },
                                resultType: {
                                    type: 'string',
                                    enum: ['all', 'news', 'blogs'],
                                    example: 'all',
                                    description: 'Type of results to return'
                                }
                            }
                        }
                    },
                },
                CrawlResponse: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', example: 'artificial intelligence' },
                        results: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    url: { type: 'string', example: 'https://example.com/article' },
                                    html: { type: 'string', example: '<div>Article content...</div>' },
                                    text: { type: 'string', example: 'Artificial intelligence (AI) is intelligence—perceiving...' },
                                    title: { type: 'string', example: 'Understanding AI' },
                                    excerpt: { type: 'string', example: 'A brief overview of artificial intelligence...' },
                                    siteName: { type: 'string', example: 'Example.com' },
                                    byline: { type: 'string', example: 'John Doe' },
                                    error: { type: 'string', example: null },
                                },
                            },
                        },
                        error: { type: 'string', example: null },
                    },
                },
                HealthCheckResponse: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['ok', 'degraded', 'down'],
                            example: 'ok'
                        },
                        details: {
                            type: 'object',
                            properties: {
                                status: {
                                    type: 'string',
                                    enum: ['ok', 'degraded', 'down'],
                                    example: 'ok'
                                },
                                flaresolverr: { type: 'boolean', example: true },
                                google: { type: 'boolean', example: true },
                                message: { type: 'string', example: null },
                            }
                        }
                    },
                },
                QuotaResponse: {
                    type: 'object',
                    properties: {
                        dailyQuota: { type: 'integer', example: 1000 },
                        usedToday: { type: 'integer', example: 150 },
                        remaining: { type: 'integer', example: 850 },
                        resetTime: { type: 'string', format: 'date-time', example: '2023-01-02T00:00:00Z' },
                    }
                }
            },
        },
        tags: [
            {
                name: 'Crawling',
                description: 'API endpoints for web crawling operations',
            },
            {
                name: 'Health',
                description: 'Health check and monitoring endpoints',
            },
        ],
    },
    apis: ['./src/controllers/*.ts', './src/routes/*.ts', './src/index.ts'],
};
exports.swaggerSpec = (0, swagger_jsdoc_1.default)(options);
