"use strict";
/**
 * Global configuration for performance monitoring
 *
 * This allows for enabling/disabling performance monitoring globally
 * without changing individual method decorators
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.perfConfig = void 0;
exports.shouldSampleCall = shouldSampleCall;
/**
 * Default configuration for performance monitoring
 */
exports.perfConfig = {
    // Turn this off in production for optimal performance if not needed
    enabled: process.env.PERF_MONITORING === 'true' || process.env.NODE_ENV !== 'production',
    // Default threshold in milliseconds
    defaultThreshold: process.env.PERF_THRESHOLD ? parseInt(process.env.PERF_THRESHOLD, 10) : 100,
    // Include environment information (false by default to minimize overhead)
    includeEnvInfo: process.env.PERF_ENV_INFO === 'true' || false,
    // Sample rate (1 = 100%, 0.1 = 10% of method calls)
    sampleRate: process.env.PERF_SAMPLE_RATE ? parseFloat(process.env.PERF_SAMPLE_RATE) : 1
};
/**
 * Check if performance monitoring should be applied for the current call
 * based on sample rate
 */
function shouldSampleCall() {
    if (!exports.perfConfig.enabled)
        return false;
    // Always sample if rate is 1
    if (exports.perfConfig.sampleRate >= 1)
        return true;
    // Skip sampling if rate is 0
    if (exports.perfConfig.sampleRate <= 0)
        return false;
    // Random sampling based on sampleRate
    return Math.random() < exports.perfConfig.sampleRate;
}
