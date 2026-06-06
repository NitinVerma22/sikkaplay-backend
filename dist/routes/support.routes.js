"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const support_controller_1 = require("../controllers/support.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// GET /api/support/faqs (Public)
router.get('/faqs', support_controller_1.getFaqs);
// POST /api/support/tickets (Public / Optional authentication handled in controller)
router.post('/tickets', support_controller_1.createTicket);
// GET /api/support/tickets (Strictly Protected - only logged-in users can see their tickets)
router.get('/tickets', auth_middleware_1.requireJwt, support_controller_1.getMyTickets);
exports.default = router;
