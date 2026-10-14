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
  adminToggleFeatureFlag,
  adminReorderTournaments,
  adminDeleteTournament,
  adminGetTournamentDetails,
  adminGetRecurringSettings,
  adminUpdateRecurringSettings,
  adminTriggerRecurringCreation,
  adminUpdateParticipantScore
} from '../controllers/tournament.controller';

const router = Router();

// ==================== PLAYER ROUTES ====================
router.get('/', requireJwt, getTournaments);
router.get('/my', requireJwt, (req, res) => {
  req.query.tab = 'my';
  return getTournaments(req as any, res);
});
router.get('/:id', requireJwt, getTournamentDetails);
router.post('/:id/join', requireJwt, joinTournament);
router.get('/:id/leaderboard', requireJwt, getLeaderboard);

// ==================== ADMIN ROUTES ====================
router.get('/admin/all', requireAdminJwt, adminListTournaments);
router.get('/admin/recurring-settings', requireAdminJwt, adminGetRecurringSettings);
router.post('/admin/recurring-settings', requireAdminJwt, adminUpdateRecurringSettings);
router.post('/admin/trigger-recurring-creation', requireAdminJwt, adminTriggerRecurringCreation);
router.post('/admin/create', requireAdminJwt, adminCreateTournament);
router.put('/admin/:id', requireAdminJwt, adminUpdateTournament);
router.delete('/admin/:id', requireAdminJwt, adminDeleteTournament);
router.get('/admin/:id/details', requireAdminJwt, adminGetTournamentDetails);
router.post('/admin/:tournamentId/participants/:userId/score', requireAdminJwt, adminUpdateParticipantScore);
router.post('/admin/reorder', requireAdminJwt, adminReorderTournaments);
router.post('/admin/:id/duplicate', requireAdminJwt, adminDuplicateTournament);
router.post('/admin/:id/cancel', requireAdminJwt, adminCancelTournament);
router.post('/admin/:id/payout', requireAdminJwt, adminTriggerPayout);
router.post('/admin/toggle-feature-flag', requireAdminJwt, adminToggleFeatureFlag);

export default router;
