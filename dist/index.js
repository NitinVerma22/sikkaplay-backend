"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
require("dotenv/config");
const path_1 = __importDefault(require("path"));
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
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const redis_adapter_1 = require("@socket.io/redis-adapter");
const ioredis_1 = __importDefault(require("ioredis"));
const matchmaking_service_1 = require("./services/matchmaking.service");
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
app.use(express_1.default.json({ limit: '5mb' }));
app.use(express_1.default.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../public/uploads')));
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
// Socket.io and Redis Adapter Setup
const httpServer = (0, http_1.createServer)(app);
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const pubClient = new ioredis_1.default(redisUrl, { maxRetriesPerRequest: null });
const subClient = pubClient.duplicate();
pubClient.on('error', (err) => {
    console.error('[Redis PubClient] Error:', err.message);
});
subClient.on('error', (err) => {
    console.error('[Redis SubClient] Error:', err.message);
});
exports.io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
        credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});
exports.io.adapter((0, redis_adapter_1.createAdapter)(pubClient, subClient));
const matchmakingService = new matchmaking_service_1.MatchmakingService(exports.io);
matchmakingService.startWorker();
// Socket Authentication Middleware
exports.io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
        return next(new Error('Authentication error: Missing token'));
    }
    // TODO: Verify Firebase JWT token here
    next();
});
exports.io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.id}`);
    socket.on('join_room', (channelName) => {
        socket.join(channelName);
        console.log(`[Socket] ${socket.id} joined room ${channelName}`);
    });
    socket.on('mark_seen', async (data) => {
        const { messageIds, channelName } = data;
        if (messageIds && Array.isArray(messageIds) && messageIds.length > 0 && channelName) {
            try {
                await db_1.prisma.playgroundMessage.updateMany({
                    where: { id: { in: messageIds } },
                    data: { isSeen: true }
                });
                // Emit to the room (except sender) that messages are seen
                socket.to(channelName).emit('message_seen', { messageIds });
                const firstMessage = await db_1.prisma.playgroundMessage.findUnique({ where: { id: messageIds[0] } });
                if (firstMessage && firstMessage.senderId) {
                    socket.to(`friend-chat-${firstMessage.senderId}`).emit('message_seen', { messageIds });
                }
            }
            catch (err) {
                console.error('Error in mark_seen socket event:', err);
            }
        }
    });
    // Tic-Tac-Toe Game Direct Socket Signaling
    socket.on('game_signal', (data) => {
        // data should contain { channelName, signal, senderId }
        if (data && data.channelName) {
            socket.to(data.channelName).emit('game_signal', data);
        }
    });
    socket.on('game_move', (data) => {
        // data should contain { channelName, index, senderId }
        if (data && data.channelName) {
            socket.to(data.channelName).emit('game_move', data);
        }
    });
    // Matchmaking Events
    socket.on('matchmaking_search_start', async (data) => {
        try {
            let { userId, gender, preference } = data;
            // Fix case sensitivity
            gender = (gender || 'male').toLowerCase();
            preference = (preference || 'random').toLowerCase();
            // Ensure valid values
            if (!['male', 'female', 'random'].includes(gender))
                gender = 'random';
            if (!['male', 'female', 'random'].includes(preference))
                preference = 'random';
            // Socket authentication happens via middleware, but ensure userId is present
            if (userId) {
                socket.data.userId = userId;
                await matchmakingService.joinSearch(userId, socket.id, gender, preference);
            }
        }
        catch (e) {
            socket.emit('matchmaking_error', { message: e.message });
        }
    });
    socket.on('matchmaking_search_cancel', async (data) => {
        try {
            const { userId } = data;
            if (userId) {
                socket.data.userId = userId;
                await matchmakingService.cancelSearch(userId);
            }
        }
        catch (e) {
            console.error('Cancel search error:', e.message);
        }
    });
    socket.on('matchmaking_heartbeat', async (data) => {
        try {
            const { userId } = data;
            if (userId) {
                socket.data.userId = userId;
                await matchmakingService.updateHeartbeat(userId);
            }
        }
        catch (e) { }
    });
    socket.on('matchmaking_leave_chat', async (data) => {
        try {
            const { userId } = data;
            if (userId) {
                socket.data.userId = userId;
                await matchmakingService.leaveChat(userId);
            }
        }
        catch (e) { }
    });
    socket.on('disconnect', async () => {
        console.log(`[Socket] User disconnected: ${socket.id}`);
        if (socket.data && socket.data.userId) {
            const userId = socket.data.userId;
            await matchmakingService.handleDisconnect(userId);
        }
        // Prevent memory leaks by removing listeners
        socket.removeAllListeners();
    });
});
// Start the server
httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
// Prevent Node.js from silently crashing due to unhandled promises
process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
    // We log it but do NOT exit the process, keeping WebSockets alive
});
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception thrown:', err);
    process.exit(1); // Must exit on uncaught exception to avoid undefined state
});
