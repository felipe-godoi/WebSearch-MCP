"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = require("winston");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Custom format to properly handle error objects
const errorFormat = (0, winston_1.format)((info) => {
    if (info.error instanceof Error) {
        // Extract error properties that aren't enumerable
        const { message, stack, name } = info.error;
        // Format the error object with proper stack trace and message
        info.error = {
            message,
            name,
            stack,
            ...info.error // Include any enumerable properties
        };
    }
    // Also check the top level message for errors
    if (info.message instanceof Error) {
        const { message, stack, name } = info.message;
        info.message = `${name}: ${message}`;
        info.stack = stack;
    }
    return info;
});
// Create a reusable, consistent logger
const logger = (0, winston_1.createLogger)({
    level: process.env.LOG_LEVEL || 'info',
    format: winston_1.format.combine(errorFormat(), winston_1.format.timestamp(), winston_1.format.json()),
    defaultMeta: { service: 'crawler' },
    transports: [
        new winston_1.transports.Console({
            format: winston_1.format.combine(winston_1.format.colorize(), winston_1.format.simple())
        })
    ]
});
exports.logger = logger;
// If we're in production, also log to a file
if (process.env.NODE_ENV === 'production') {
    logger.add(new winston_1.transports.File({ filename: 'logs/error.log', level: 'error' }));
    logger.add(new winston_1.transports.File({ filename: 'logs/combined.log' }));
}
