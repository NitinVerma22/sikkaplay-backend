import { Router } from 'express';
import { getFaqs, createTicket, getMyTickets } from '../controllers/support.controller';
import { requireJwt } from '../middleware/auth.middleware';

const router = Router();

// GET /api/support/faqs (Public)
router.get('/faqs', getFaqs);

// POST /api/support/tickets (Public / Optional authentication handled in controller)
router.post('/tickets', createTicket);

// GET /api/support/tickets (Strictly Protected - only logged-in users can see their tickets)
router.get('/tickets', requireJwt, getMyTickets);

export default router;
