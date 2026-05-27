import { Router } from 'express';
import { getFaqs, createTicket, getMyTickets } from '../controllers/support.controller';
import { requireJwt } from '../middleware/auth.middleware';

const router = Router();

// Protect all support routes with JWT validation
router.use(requireJwt);

// GET /api/support/faqs
router.get('/faqs', getFaqs);

// POST /api/support/tickets
router.post('/tickets', createTicket);

// GET /api/support/tickets
router.get('/tickets', getMyTickets);

export default router;
