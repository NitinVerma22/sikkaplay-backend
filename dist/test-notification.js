"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const db_1 = require("./config/db");
const admin = __importStar(require("firebase-admin"));
require("./config/firebase");
async function test() {
    console.log("Starting test...");
    try {
        const usersCount = await db_1.prisma.user.count();
        console.log("Users count in DB:", usersCount);
        // Test FCM
        console.log("Testing Firebase Admin SDK initialization...");
        console.log("Firebase App Name:", admin.apps[0]?.name || "None");
        // Try to get a user with an FCM token
        const user = await db_1.prisma.user.findFirst({
            where: {
                fcmToken: { not: null }
            }
        });
        console.log("User with FCM token:", user ? { id: user.id, phoneNumber: user.phoneNumber, tokenLength: user.fcmToken?.length } : "None found");
    }
    catch (err) {
        console.error("Test failed with error:", err);
    }
    finally {
        await db_1.prisma.$disconnect();
        process.exit(0);
    }
}
test();
