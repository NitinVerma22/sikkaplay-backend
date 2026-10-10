import { Router } from 'express';
import { requireJwt } from '../middleware/auth.middleware';
import { requireAdminJwt } from '../middleware/adminAuth.middleware';
import {
  getTournaments,
  getTournamentDetails,
  joinTournament,
  getLeaderboard,
  adminListTournaments,
  adminCreateTournament,
  adminUpdateTournament,
  adminDuplicateTournament,
  adminCancelTournament,
  adminTriggerPayout,
  adminToggleFeatureFlag
} from '../controllers/tournament.controller';

const router = Router();

// ==================== PLAYER ROUTES ====================
router.get('/', requireJwt, getTournaments);
router.get('/:id', requireJwt, getTournamentDetails);
router.post('/:id/join', requireJwt, joinTournament);
router.get('/:id/leaderboard', requireJwt, getLeaderboard);

// ==================== ADMIN ROUTES ====================
router.get('/admin/all', requireAdminJwt, adminListTournaments);
router.post('/admin/create', requireAdminJwt, adminCreateTournament);
router.put('/admin/:id', requireAdminJwt, adminUpdateTournament);
router.post('/admin/:id/duplicate', requireAdminJwt, adminDuplicateTournament);
router.post('/admin/:id/cancel', requireAdminJwt, adminCancelTournament);
router.post('/admin/:id/payout', requireAdminJwt, adminTriggerPayout);
router.post('/admin/toggle-feature-flag', requireAdminJwt, adminToggleFeatureFlag);

export default router;
