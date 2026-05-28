"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./config/db");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const config_routes_1 = __importDefault(require("./routes/config.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const support_routes_1 = __importDefault(require("./routes/support.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const cron_service_1 = require("./services/cron.service");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
(0, cron_service_1.startCronJobs)();
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api/user', user_routes_1.default);
app.use('/api/config', config_routes_1.default);
app.use('/api/notifications', notification_routes_1.default);
app.use('/api/support', support_routes_1.default);
app.use('/api/admin', admin_routes_1.default);
// Basic health check route
app.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'SikkaPlay API is running' });
});
// Test DB Connection
app.get('/api/test-db', async (req, res) => {
    try {
        const usersCount = await db_1.prisma.user.count();
        res.status(200).json({ status: 'success', message: 'Database connected successfully!', usersCount });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: 'Database connection failed', error });
    }
});
// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
