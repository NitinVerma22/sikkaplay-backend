"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const srcDir = path_1.default.resolve(__dirname);
function walk(dir, callback) {
    const files = fs_1.default.readdirSync(dir);
    for (const file of files) {
        const filepath = path_1.default.join(dir, file);
        const stat = fs_1.default.statSync(filepath);
        if (stat.isDirectory()) {
            walk(filepath, callback);
        }
        else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
            callback(filepath);
        }
    }
}
console.log("Searching for 'push.service' or 'sendPushNotification' imports in:", srcDir);
walk(srcDir, (filePath) => {
    const content = fs_1.default.readFileSync(filePath, 'utf-8');
    if (content.includes('push.service') || content.includes('sendPushNotification')) {
        console.log("Found reference in file:", path_1.default.relative(srcDir, filePath));
    }
});
process.exit(0);
