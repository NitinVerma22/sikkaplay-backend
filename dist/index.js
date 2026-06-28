"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const db_1 = require("./config/db");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const config_routes_1 = __importDefault(require("./routes/config.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const support_routes_1 = __importDefault(require("./routes/support.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const callback_routes_1 = __importDefault(require("./routes/callback.routes"));
const game_routes_1 = __importDefault(require("./routes/game.routes"));
const playground_routes_1 = __importDefault(require("./routes/playground.routes"));
const cron_service_1 = require("./services/cron.service");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
(0, cron_service_1.startCronJobs)();
// Middleware
app.use((0, helmet_1.default)());
app.use((0, compression_1.default)());
const allowedOrigins = [
    'http://localhost:5173', // Admin local dev
    'http://localhost:3000', // API local dev
    'https://sikkaplay-admin.web.app', // Admin production web app
    'https://sikkaplay.web.app' // Frontend production web app
];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, native devices)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true
}));
app.use(express_1.default.json());
// API Request/Response Logger
app.use((req, res, next) => {
    console.log(`[API REQUEST] ${req.method} ${req.url}`);
    res.on('finish', () => {
        if (res.statusCode >= 400) {
            console.log(`[API ERROR RESPONSE] ${req.method} ${req.url} -> ${res.statusCode}`);
        }
        else {
            console.log(`[API RESPONSE] ${req.method} ${req.url} -> ${res.statusCode}`);
        }
    });
    next();
});
// Routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api/user', user_routes_1.default);
app.use('/api/config', config_routes_1.default);
app.use('/api/notifications', notification_routes_1.default);
app.use('/api/support', support_routes_1.default);
app.use('/api/admin', admin_routes_1.default);
app.use('/api/callbacks', callback_routes_1.default);
app.use('/api/game', game_routes_1.default);
app.use('/api/playground', playground_routes_1.default);
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
// Global error handler middleware
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});
// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
