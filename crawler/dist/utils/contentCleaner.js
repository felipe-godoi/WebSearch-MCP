"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentCleaner = void 0;
const jsdom_1 = require("jsdom");
const performance_1 = require("./performance");
const logger_1 = require("./logger");
/**
 * ContentCleaner class for sanitizing and extracting meaningful content from raw HTML
 * This class provides methods to clean up HTML, fix encoding issues, and extract
 * structured data from search results.
 */
class ContentCleaner {
    /**
     * Clean raw search result HTML content
     * @param rawHtml The raw HTML content to clean
     * @returns Cleaned HTML content with encoding fixes and unnecessary elements removed
     */
    cleanHtml(rawHtml) {
        try {
            // Fix encoding issues
            let cleanedHtml = this.fixEncoding(rawHtml);
            cleanedHtml = this.replaceHtmlLineBreaks(cleanedHtml);
            // Parse the HTML with JSDOM
            const dom = new jsdom_1.JSDOM(cleanedHtml);
            const document = dom.window.document;
            // Remove script and style elements
            this.removeElements(document, "script, style, iframe, noscript");
            // Remove hidden elements
            this.removeHiddenElements(document);
            // Fix broken or messy attributes
            this.fixAttributes(document);
            // Get the sanitized HTML
            cleanedHtml = document.documentElement.outerHTML;
            return cleanedHtml;
        }
        catch (error) {
            logger_1.logger.error("Error cleaning HTML", { error });
            return rawHtml; // Return original if cleaning fails
        }
    }
    replaceHtmlLineBreaks(html) {
        return html.replace(/<p\b[^>]*>.*?<\/p>/gs, "\n\n");
    }
    /**
     * Fix encoding issues in text
     * @param text Text with potential encoding problems
     * @returns Fixed text with proper encoding
     */
    fixEncoding(text) {
        // Fix common encoding issues
        return text
            .replace(/�/g, "") // Remove replacement character
            .replace(/\&\#x[0-9A-F]+;/gi, (match) => {
            try {
                // Try to convert hex entity to character
                const hex = match.substring(3, match.length - 1);
                return String.fromCodePoint(parseInt(hex, 16));
            }
            catch {
                return match;
            }
        })
            .replace(/\&\#[0-9]+;/g, (match) => {
            try {
                // Try to convert decimal entity to character
                const decimal = match.substring(2, match.length - 1);
                return String.fromCodePoint(parseInt(decimal, 10));
            }
            catch {
                return match;
            }
        });
    }
    /**
     * Remove elements matching a selector from a document
     * @param document DOM document
     * @param selector CSS selector for elements to remove
     */
    removeElements(document, selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => el.parentNode?.removeChild(el));
    }
    /**
     * Remove hidden elements from document
     * @param document DOM document
     */
    removeHiddenElements(document) {
        // Find elements with display:none or visibility:hidden
        const elements = document.querySelectorAll("*");
        elements.forEach((el) => {
            const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
            if (style &&
                (style.display === "none" || style.visibility === "hidden")) {
                el.parentNode?.removeChild(el);
            }
        });
    }
    /**
     * Fix broken or messy attributes in elements
     * @param document DOM document
     */
    fixAttributes(document) {
        // Fix common issues with attributes
        const elements = document.querySelectorAll("img, a");
        elements.forEach((el) => {
            const attributes = el.attributes;
            for (let i = 0; i < attributes.length; i++) {
                const attr = attributes[i];
                // Fix broken URLs and paths
                if (attr.name === "src" || attr.name === "href") {
                    if (attr.value.startsWith('\\"') && attr.value.endsWith('\\"')) {
                        el.setAttribute(attr.name, attr.value.substring(2, attr.value.length - 2));
                    }
                }
                // Remove invalid attributes
                if (attr.name.includes("\\") || attr.name.includes('"')) {
                    el.removeAttribute(attr.name);
                }
            }
        });
    }
    /**
     * Extract clean text from HTML content
     * @param html HTML content
     * @param options Configuration options for text extraction
     * @returns Plain text without HTML tags and with formatting according to options
     */
    extractText(html, options) {
        try {
            const dom = new jsdom_1.JSDOM(html);
            const document = dom.window.document;
            // Get text content
            let text = document.body.textContent || "";
            text = text
                .replace(/[^\S\n]+/g, " ")
                .replace(/(\n +| +\n)/g, '\n\n')
                .replace(/\n{3,}/g, "\n\n");
            // Trim leading/trailing whitespace
            text = text.trim();
            return text;
        }
        catch (error) {
            logger_1.logger.error("Error extracting text", { error });
            // Fall back to naive tag removal if JSDOM fails
            let text = html.replace(/<[^>]*>/g, " "); // Replace HTML tags with space
            text = text
                .replace(/ +/g, " ")
                .replace(/(\n )|( \n)/g, "\n\n")
                .replace(/\n{3,}/g, "\n\n");
            return text.trim();
        }
    }
    /**
     * Process raw PowerShell response from search API
     * @param rawResponse Raw PowerShell response object
     * @param options Configuration options for text extraction
     * @returns Cleaned and structured content
     */
    processRawResponse(rawResults, options) {
        try {
            // Process each result
            return rawResults.map((result) => {
                const cleanedHtml = this.cleanHtml(result.html || "");
                const cleanedText = this.extractText(result.text || "", options);
                // const cleanedText = cleanedHtml;
                return {
                    url: result.url || "",
                    html: cleanedHtml,
                    text: cleanedText,
                    title: result.title || "",
                    excerpt: result.excerpt || undefined,
                    siteName: result.siteName || undefined,
                    byline: result.byline || undefined,
                };
            });
        }
        catch (error) {
            logger_1.logger.error("Error processing raw response", { error });
            return [];
        }
    }
}
exports.ContentCleaner = ContentCleaner;
__decorate([
    (0, performance_1.logPerfTime)("ContentCleaner:cleanHtml", {
        threshold: 200,
        includeArgs: false,
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", String)
], ContentCleaner.prototype, "cleanHtml", null);
