"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_controller_1 = require("../controllers/config.controller");
const router = (0, express_1.Router)();
// Route to get app configuration like latest version, maintenance mode etc.
router.get('/', config_controller_1.getAppConfig);
exports.default = router;
