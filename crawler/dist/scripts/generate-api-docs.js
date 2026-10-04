"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const swagger_1 = require("../config/swagger");
/**
 * Converts a Swagger specification to Markdown documentation
 */
function generateMarkdownDocs(spec) {
    let markdown = `# WebSearch API - Crawler Service\n\n`;
    // Add API info
    markdown += `${spec.info.description || 'API Documentation'}\n\n`;
    markdown += `- Version: ${spec.info.version}\n`;
    if (spec.info.contact) {
        markdown += `- Contact: [${spec.info.contact.name}](${spec.info.contact.url})\n`;
    }
    markdown += `- License: [${spec.info.license.name}](${spec.info.license.url})\n\n`;
    // Add table of contents
    markdown += `## Table of Contents\n\n`;
    // Group endpoints by tags
    const pathsByTag = {};
    // Process each path
    Object.entries(spec.paths).forEach(([path, pathItem]) => {
        Object.entries(pathItem).forEach(([method, operation]) => {
            if (!operation.tags || operation.tags.length === 0) {
                operation.tags = ['General'];
            }
            operation.tags.forEach((tag) => {
                if (!pathsByTag[tag]) {
                    pathsByTag[tag] = [];
                }
                pathsByTag[tag].push({
                    path,
                    method,
                    operation
                });
            });
        });
    });
    // Add tags to ToC
    Object.keys(pathsByTag).forEach(tag => {
        markdown += `- [${tag}](#${tag.toLowerCase().replace(/\s+/g, '-')})\n`;
    });
    markdown += `\n`;
    // Generate details for each tag
    Object.entries(pathsByTag).forEach(([tag, operations]) => {
        markdown += `## ${tag}\n\n`;
        operations.forEach(({ path, method, operation }) => {
            // Endpoint header
            markdown += `### ${operation.summary || path}\n\n`;
            markdown += `\`${method.toUpperCase()} ${path}\`\n\n`;
            if (operation.description) {
                markdown += `${operation.description}\n\n`;
            }
            // Parameters
            if (operation.parameters && operation.parameters.length > 0) {
                markdown += `#### Parameters\n\n`;
                markdown += `| Name | Located in | Description | Required | Type |\n`;
                markdown += `| ---- | ---------- | ----------- | -------- | ---- |\n`;
                operation.parameters.forEach((parameter) => {
                    markdown += `| ${parameter.name} | ${parameter.in} | ${parameter.description || ''} | ${parameter.required ? 'Yes' : 'No'} | ${parameter.schema ? parameter.schema.type : 'Unknown'} |\n`;
                });
                markdown += `\n`;
            }
            // Request body
            if (operation.requestBody) {
                markdown += `#### Request Body\n\n`;
                if (operation.requestBody.description) {
                    markdown += `${operation.requestBody.description}\n\n`;
                }
                if (operation.requestBody.content) {
                    Object.entries(operation.requestBody.content).forEach(([contentType, content]) => {
                        markdown += `Content Type: \`${contentType}\`\n\n`;
                        if (content.schema) {
                            if (content.schema.$ref) {
                                const ref = content.schema.$ref.split('/').pop();
                                markdown += `Schema: [${ref}](#${ref.toLowerCase()})\n\n`;
                            }
                            else {
                                markdown += `Schema: ${content.schema.type}\n\n`;
                            }
                        }
                    });
                }
            }
            // Responses
            if (operation.responses) {
                markdown += `#### Responses\n\n`;
                markdown += `| Status | Description |\n`;
                markdown += `| ------ | ----------- |\n`;
                Object.entries(operation.responses).forEach(([status, response]) => {
                    markdown += `| ${status} | ${response.description || ''} |\n`;
                });
                markdown += `\n`;
            }
            markdown += `---\n\n`;
        });
    });
    // Add schemas/models
    if (spec.components && spec.components.schemas) {
        markdown += `## Models\n\n`;
        Object.entries(spec.components.schemas).forEach(([name, schema]) => {
            markdown += `### ${name}\n\n`;
            if (schema.type) {
                markdown += `Type: \`${schema.type}\`\n\n`;
            }
            if (schema.properties) {
                markdown += `| Property | Type | Description | Example |\n`;
                markdown += `| -------- | ---- | ----------- | ------- |\n`;
                Object.entries(schema.properties).forEach(([propName, property]) => {
                    const type = property.type || (property.$ref ? property.$ref.split('/').pop() : 'object');
                    const description = property.description || '';
                    const example = property.example !== undefined ? JSON.stringify(property.example) : '';
                    markdown += `| ${propName} | ${type} | ${description} | ${example} |\n`;
                });
                markdown += `\n`;
            }
        });
    }
    return markdown;
}
// Create the output directory if it doesn't exist
const outputDir = path_1.default.resolve(__dirname, '../../../documentation/crawler/api');
if (!fs_1.default.existsSync(outputDir)) {
    fs_1.default.mkdirSync(outputDir, { recursive: true });
}
// Generate markdown documentation
const markdown = generateMarkdownDocs(swagger_1.swaggerSpec);
// Write markdown to file
const markdownPath = path_1.default.join(outputDir, 'api-docs.md');
fs_1.default.writeFileSync(markdownPath, markdown, 'utf8');
// Write the swagger spec to a JSON file
const jsonPath = path_1.default.join(outputDir, 'swagger.json');
fs_1.default.writeFileSync(jsonPath, JSON.stringify(swagger_1.swaggerSpec, null, 2), 'utf8');
console.log(`API Documentation generated successfully!`);
console.log(`- Markdown: ${markdownPath}`);
console.log(`- JSON: ${jsonPath}`);
