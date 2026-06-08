"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const admin_controller_1 = require("./controllers/admin.controller");
const db_1 = require("./config/db");
async function test() {
    console.log("Starting broadcastPushNotification controller test...");
    // Mock Request
    const mockReq = {
        body: {
            title: "Test Broadcast",
            body: "This is a test notification body",
            type: "alert",
            targetType: "all"
        }
    };
    // Mock Response
    let statusResult = 200;
    let jsonResult = null;
    const mockRes = {
        status: (code) => {
            statusResult = code;
            return mockRes;
        },
        json: (data) => {
            jsonResult = data;
            return mockRes;
        }
    };
    try {
        await (0, admin_controller_1.broadcastPushNotification)(mockReq, mockRes);
        console.log("Response Status:", statusResult);
        console.log("Response JSON:", jsonResult);
    }
    catch (err) {
        console.error("Controller crashed directly:", err);
    }
    finally {
        await db_1.prisma.$disconnect();
        process.exit(0);
    }
}
test();
