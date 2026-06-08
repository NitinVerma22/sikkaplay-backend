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
const admin = __importStar(require("firebase-admin"));
require("./config/firebase");
async function test() {
    console.log("Starting sendEach test...");
    try {
        const messages = [
            {
                token: 'eZHqz69GQGCgbxRElO3Bk6:APA91bHMn-Q38Iy-KIKCjdj43PhkMZsvWWBE7mPZiML0ka-MSwYfmngSUjbt7UnR9RJTuQReRirS1Z0czgkcs1V9x5lNwD8t6elmwsjJLP3HWf5YvH-TVXg',
                notification: { title: "Test Batch", body: "Hello from sendEach" },
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'sikkaplay_high_channel',
                        color: '#7C3AED',
                        icon: 'ic_launcher',
                    }
                }
            }
        ];
        console.log("Calling sendEach...");
        const response = await admin.messaging().sendEach(messages);
        console.log("sendEach completed! Success count:", response.successCount, "Failure count:", response.failureCount);
    }
    catch (err) {
        console.error("sendEach failed with error:", err);
    }
    finally {
        process.exit(0);
    }
}
test();
