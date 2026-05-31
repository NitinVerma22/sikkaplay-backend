"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const callback_controller_1 = require("../controllers/callback.controller");
const router = (0, express_1.Router)();
// Public webhook route called by CPX Research
// Supports both GET and POST requests
router.get('/cpx', callback_controller_1.handleCpxCallback);
router.post('/cpx', callback_controller_1.handleCpxCallback);
exports.default = router;
