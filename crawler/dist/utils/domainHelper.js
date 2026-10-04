"use strict";
/**
 * Utility functions for working with domains and URLs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDomain = extractDomain;
exports.isDomainMatch = isDomainMatch;
exports.createExcludeDomainFilter = createExcludeDomainFilter;
exports.formatExcludedDomainsParam = formatExcludedDomainsParam;
/**
 * Extract domain from a URL
 * @param url The URL to extract domain from
 * @returns The domain name without protocol, www, or paths
 */
function extractDomain(url) {
    try {
        // Parse the URL to get hostname
        const parsedUrl = new URL(url);
        let hostname = parsedUrl.hostname;
        // Remove www. prefix if present
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        return hostname;
    }
    catch (error) {
        // If URL parsing fails, try a simple regex extraction
        const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
        if (match && match[1]) {
            return match[1];
        }
        // Return the original URL if all extraction attempts fail
        return url;
    }
}
/**
 * Check if a URL belongs to a specific domain
 * @param url The URL to check
 * @param domain The domain to check against
 * @returns True if URL is from the specified domain
 */
function isDomainMatch(url, domain) {
    const urlDomain = extractDomain(url);
    return urlDomain === domain || urlDomain.endsWith(`.${domain}`);
}
/**
 * Create a domain filter string for Google search
 * @param domains List of domains to exclude
 * @returns A filter string that can be appended to Google search URL
 */
function createExcludeDomainFilter(domains) {
    if (!domains.length)
        return '';
    return domains
        .map(domain => `-site:${domain}`)
        .join(' ');
}
/**
 * Format a list of domains as excluded domains query parameter
 * @param domains List of domains to exclude
 * @returns Formatted query parameter string
 */
function formatExcludedDomainsParam(domains) {
    if (!domains.length)
        return '';
    return domains
        .map(domain => encodeURIComponent(`-site:${domain}`))
        .join('+');
}
