"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const contentCleaner_1 = require("../utils/contentCleaner");
/**
 * Example script to demonstrate how to use the ContentCleaner
 * to extract and clean content from raw search API responses
 */
async function main() {
    try {
        // Create instance of the content cleaner
        const cleaner = new contentCleaner_1.ContentCleaner();
        // Path to a JSON file containing the raw response
        // This would be your raw PowerShell response saved to a file
        const inputFilePath = process.argv[2] || path_1.default.join(__dirname, '../../storage/raw/example_response.json');
        // Path to save the cleaned results
        const outputFilePath = process.argv[3] || path_1.default.join(__dirname, '../../storage/processed/cleaned_results.json');
        console.log(`Reading raw response from: ${inputFilePath}`);
        // Read the raw response file
        const rawResponseData = await promises_1.default.readFile(inputFilePath, 'utf-8');
        // Parse the raw response
        let rawResponse;
        try {
            rawResponse = JSON.parse(rawResponseData);
        }
        catch (error) {
            console.error('Error parsing raw response:', error);
            rawResponse = { Content: rawResponseData };
        }
        // Process the raw response
        const cleanedResults = cleaner.processRawResponse(rawResponse);
        // Save the cleaned results
        await promises_1.default.writeFile(outputFilePath, JSON.stringify({
            query: "Original query",
            results: cleanedResults,
            processedAt: new Date().toISOString()
        }, null, 2));
        console.log(`Processed ${cleanedResults.length} results`);
        console.log(`Cleaned results saved to: ${outputFilePath}`);
        // Display a sample of the cleaned text from the first result
        if (cleanedResults.length > 0) {
            const firstResult = cleanedResults[0];
            console.log('\nSample of cleaned content from first result:');
            console.log(`URL: ${firstResult.url}`);
            console.log(`Title: ${firstResult.title || 'N/A'}`);
            console.log('Text preview:');
            console.log(firstResult.text.substring(0, 300) + '...');
        }
    }
    catch (error) {
        console.error('Error in content cleaning script:', error);
        process.exit(1);
    }
}
// Run the script
main();
