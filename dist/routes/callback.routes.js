"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const callback_controller_1 = require("../controllers/callback.controller");
const tapjoy_controller_1 = require("../controllers/tapjoy.controller");
const timewall_controller_1 = require("../controllers/timewall.controller");
const cpalead_controller_1 = require("../controllers/cpalead.controller");
const adgem_controller_1 = require("../controllers/adgem.controller");
const adscalex_controller_1 = require("../controllers/adscalex.controller");
const router = (0, express_1.Router)();
// Public webhook route called by CPX Research
// Supports both GET and POST requests
router.get('/cpx', callback_controller_1.handleCpxCallback);
router.post('/cpx', callback_controller_1.handleCpxCallback);
// Public webhook route called by Google AdMob SSV
router.get('/admob-ssv', callback_controller_1.handleAdmobSsvCallback);
// Public webhook route called by Tapjoy Offerwall self-managed currency
router.get('/tapjoy', tapjoy_controller_1.handleTapjoyCallback);
// Public webhook route called by TimeWall Offerwall
router.get('/timewall', timewall_controller_1.handleTimewallCallback);
router.post('/timewall', timewall_controller_1.handleTimewallCallback);
// Public webhook route called by CPAlead Offerwall
router.get('/cpalead', cpalead_controller_1.handleCpaleadCallback);
// Public webhook route called by AdGem GET server postback (v2)
router.get('/adgem', adgem_controller_1.handleAdgemCallback);
// Public webhook route called by AdScaleX signed S2S callback.
// The handler verifies the raw JSON body, timestamp and HMAC signature.
router.post('/adscalex', adscalex_controller_1.handleAdscalexCallback);
exports.default = router;
