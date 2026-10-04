"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rotator = void 0;
const logger_1 = require("./logger");
class Rotator {
    constructor() {
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
        logger_1.logger.info('Rotator initialized with user agent rotation');
    }
    /**
     * Get a random user agent
     */
    getUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }
}
exports.Rotator = Rotator;
