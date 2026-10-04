"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const swagger_1 = require("../config/swagger");
// Create the directory if it doesn't exist
const outputDir = path_1.default.resolve(__dirname, '../../../documentation/crawler/api');
if (!fs_1.default.existsSync(outputDir)) {
    fs_1.default.mkdirSync(outputDir, { recursive: true });
}
// Write the swagger spec to a file
const outputPath = path_1.default.join(outputDir, 'swagger.json');
fs_1.default.writeFileSync(outputPath, JSON.stringify(swagger_1.swaggerSpec, null, 2), 'utf8');
console.log(`Swagger JSON file generated at: ${outputPath}`);
