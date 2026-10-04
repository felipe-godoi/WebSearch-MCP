"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerfTimer = void 0;
exports.logPerfTime = logPerfTime;
exports.logFunctionPerfTime = logFunctionPerfTime;
const logger_1 = require("./logger");
const perf_hooks_1 = require("perf_hooks");
const perfConfig_1 = require("./perfConfig");
const os_1 = __importDefault(require("os"));
/**
 * Default options for performance logging
 */
const defaultOptions = {
    threshold: perfConfig_1.perfConfig.defaultThreshold, // Use global threshold by default
    level: 'debug',
    includeArgs: false,
    includeResult: false,
};
/**
 * Decorator that logs the execution time of a method
 * @param name Custom name for the log entry
 * @param options Configuration options
 */
function logPerfTime(name, options = {}) {
    // Merge with default options
    const opts = { ...defaultOptions, ...options };
    return function (target, propertyKey, descriptor) {
        // Store the original method
        const originalMethod = descriptor.value;
        // Replace the method with our timing wrapper
        descriptor.value = function (...args) {
            // Skip performance monitoring if globally disabled or not sampled
            if (!perfConfig_1.perfConfig.enabled || !(0, perfConfig_1.shouldSampleCall)()) {
                return originalMethod.apply(this, args);
            }
            // Use high-resolution timer for accuracy
            const startTime = perf_hooks_1.performance.now();
            // Create a unique ID for this execution (useful for async functions)
            const executionId = Math.random().toString(36).substring(2, 9);
            try {
                // Execute the original method
                const result = originalMethod.apply(this, args);
                // If it's a Promise, attach timing handlers
                if (result instanceof Promise) {
                    return result.then((value) => {
                        logExecutionTime(true, value);
                        return value;
                    }).catch((error) => {
                        logExecutionTime(false, undefined, error);
                        throw error;
                    });
                }
                // For synchronous functions, log immediately
                logExecutionTime(true, result);
                return result;
            }
            catch (error) {
                logExecutionTime(false, undefined, error);
                throw error;
            }
            // Helper function to log execution time
            function logExecutionTime(success, returnValue, error) {
                const endTime = perf_hooks_1.performance.now();
                const executionTime = endTime - startTime;
                // Only log if execution time exceeds threshold
                if (executionTime < opts.threshold) {
                    return;
                }
                const methodName = name || `${target.constructor.name}.${propertyKey}`;
                let logObject = {
                    perf: {
                        id: executionId,
                        method: methodName,
                        executionTime: `${executionTime.toFixed(2)}ms`,
                        success
                    }
                };
                // Include environment info if configured
                if (perfConfig_1.perfConfig.includeEnvInfo) {
                    logObject.perf.env = {
                        memory: process.memoryUsage().heapUsed / 1024 / 1024,
                        cpu: os_1.default.loadavg()[0],
                        uptime: process.uptime()
                    };
                }
                // Optionally include arguments
                if (opts.includeArgs && args.length > 0) {
                    // Safely stringify arguments (handle circular references)
                    try {
                        logObject.perf.args = args.map(arg => typeof arg === 'object' ?
                            JSON.stringify(arg, null, 0).substring(0, 200) :
                            String(arg));
                    }
                    catch (e) {
                        logObject.perf.args = ['[Circular structure]'];
                    }
                }
                // Optionally include result
                if (opts.includeResult && success) {
                    try {
                        logObject.perf.result = typeof returnValue === 'object' ?
                            JSON.stringify(returnValue, null, 0).substring(0, 200) :
                            String(returnValue);
                    }
                    catch (e) {
                        logObject.perf.result = '[Circular structure]';
                    }
                }
                // Include error if any
                if (!success && error) {
                    logObject.perf.error = error.message || String(error);
                }
                // Log using the specified level
                logger_1.logger['debug'](`Performance: ${methodName} took ${executionTime.toFixed(2)}ms`, logObject);
            }
        };
        return descriptor;
    };
}
/**
 * Function decorator variant for non-class methods
 * @param name Custom name for the log entry
 * @param options Configuration options
 */
function logFunctionPerfTime(name, options = {}) {
    // Merge with default options
    const opts = { ...defaultOptions, ...options };
    return function (fn) {
        return function (...args) {
            // Skip performance monitoring if globally disabled or not sampled
            if (!perfConfig_1.perfConfig.enabled || !(0, perfConfig_1.shouldSampleCall)()) {
                return fn.apply(this, args);
            }
            const startTime = perf_hooks_1.performance.now();
            const executionId = Math.random().toString(36).substring(2, 9);
            try {
                const result = fn.apply(this, args);
                if (result instanceof Promise) {
                    return result.then((value) => {
                        logTime(true, value);
                        return value;
                    }).catch((error) => {
                        logTime(false, undefined, error);
                        throw error;
                    });
                }
                logTime(true, result);
                return result;
            }
            catch (error) {
                logTime(false, undefined, error);
                throw error;
            }
            function logTime(success, returnValue, error) {
                const endTime = perf_hooks_1.performance.now();
                const executionTime = endTime - startTime;
                if (executionTime < opts.threshold) {
                    return;
                }
                let logObject = {
                    perf: {
                        id: executionId,
                        function: name,
                        executionTime: `${executionTime.toFixed(2)}ms`,
                        success
                    }
                };
                // Include environment info if configured
                if (perfConfig_1.perfConfig.includeEnvInfo) {
                    logObject.perf.env = {
                        memory: process.memoryUsage().heapUsed / 1024 / 1024,
                        cpu: os_1.default.loadavg()[0],
                        uptime: process.uptime()
                    };
                }
                if (opts.includeArgs && args.length > 0) {
                    try {
                        logObject.perf.args = args.map(arg => typeof arg === 'object' ?
                            JSON.stringify(arg, null, 0).substring(0, 200) :
                            String(arg));
                    }
                    catch (e) {
                        logObject.perf.args = ['[Circular structure]'];
                    }
                }
                if (opts.includeResult && success) {
                    try {
                        logObject.perf.result = typeof returnValue === 'object' ?
                            JSON.stringify(returnValue, null, 0).substring(0, 200) :
                            String(returnValue);
                    }
                    catch (e) {
                        logObject.perf.result = '[Circular structure]';
                    }
                }
                if (!success && error) {
                    logObject.perf.error = error.message || String(error);
                }
                logger_1.logger[opts.level](`Performance: ${name} took ${executionTime.toFixed(2)}ms`, logObject);
            }
        };
    };
}
/**
 * Utility to manually time code execution
 * Useful for timing specific parts of a method
 */
class PerfTimer {
    constructor(name, options = {}) {
        this.name = name;
        this.options = { ...defaultOptions, ...options };
        this.startTime = perf_hooks_1.performance.now();
    }
    /**
     * Stop timing and log the result
     * @param additionalInfo Any additional info to log
     */
    stop(additionalInfo = {}) {
        // Skip if performance monitoring is disabled
        if (!perfConfig_1.perfConfig.enabled)
            return 0;
        const endTime = perf_hooks_1.performance.now();
        const executionTime = endTime - this.startTime;
        // Only log if execution time exceeds threshold
        if (executionTime < this.options.threshold) {
            return executionTime;
        }
        const logObject = {
            perf: {
                operation: this.name,
                executionTime: `${executionTime.toFixed(2)}ms`,
                ...additionalInfo
            }
        };
        // Include environment info if configured
        if (perfConfig_1.perfConfig.includeEnvInfo) {
            logObject.perf.env = {
                memory: process.memoryUsage().heapUsed / 1024 / 1024,
                cpu: os_1.default.loadavg()[0],
                uptime: process.uptime()
            };
        }
        logger_1.logger[this.options.level](`Performance: ${this.name} took ${executionTime.toFixed(2)}ms`, logObject);
        return executionTime;
    }
}
exports.PerfTimer = PerfTimer;
