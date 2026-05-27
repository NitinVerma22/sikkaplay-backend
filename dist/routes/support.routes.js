"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const support_controller_1 = require("../controllers/support.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Protect all support routes with JWT validation
router.use(auth_middleware_1.requireJwt);
// GET /api/support/faqs
router.get('/faqs', support_controller_1.getFaqs);
// POST /api/support/tickets
router.post('/tickets', support_controller_1.createTicket);
// GET /api/support/tickets
router.get('/tickets', support_controller_1.getMyTickets);
exports.default = router;
