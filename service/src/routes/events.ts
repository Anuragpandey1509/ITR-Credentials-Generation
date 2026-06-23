import { Router, Request, Response } from 'express';
import { getAllEvents } from '../repository/event-repo';
import { requireBearer } from '../middleware/auth';

export const eventsRouter = Router();

// ---------------------------------------------------------------------------
// GET /jobs/:id/events — full event history for a run (for drill-down)
// ---------------------------------------------------------------------------

eventsRouter.get('/:id/events', requireBearer, async (req: Request, res: Response) => {
  const events = await getAllEvents(req.params['id']!);
  return res.json({ events, count: events.length });
});
