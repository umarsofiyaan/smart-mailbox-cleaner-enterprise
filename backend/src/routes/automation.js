const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');

const { requireAuth } = require('../middleware/auth');
const { automationLimiter } = require('../middleware/security');
const {
  createPlaybook,
  listPlaybooks,
  updatePlaybook,
  deletePlaybook,
  getPlaybook,
  previewPlaybook,
  enqueuePlaybookRun,
  listRuns,
  getLatestInsights,
} = require('../services/playbookService');
const logger = require('../utils/logger');

router.use(requireAuth);

router.get('/playbooks', async (req, res) => {
  try {
    const result = await listPlaybooks(req.user.id);
    return res.json(result);
  } catch (err) {
    logger.error('Failed to list playbooks', err);
    return res.status(500).json({ error: 'Failed to list playbooks.' });
  }
});

router.post(
  '/playbooks',
  automationLimiter,
  [
    body('name').isString().isLength({ min: 1, max: 120 }),
    body('query').isString().isLength({ min: 1, max: 2000 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const playbook = await createPlaybook(req.user.id, req.body);
      return res.status(201).json({ playbook });
    } catch (err) {
      if (err.code === 'PLAYBOOK_LIMIT_REACHED' || String(err.message || '').startsWith('PLAYBOOK_LIMIT_REACHED')) {
        return res.status(403).json({ error: 'Playbook limit reached for your plan.', code: 'PLAYBOOK_LIMIT_REACHED' });
      }
      logger.error('Failed to create playbook', err);
      return res.status(500).json({ error: 'Failed to create playbook.' });
    }
  }
);

router.patch(
  '/playbooks/:id',
  automationLimiter,
  [
    param('id').isUUID(),
    body('name').optional().isString().isLength({ min: 1, max: 120 }),
    body('query').optional().isString().isLength({ min: 1, max: 2000 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const playbook = await updatePlaybook(req.user.id, req.params.id, req.body);
      return res.json({ playbook });
    } catch (err) {
      if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
      logger.error('Failed to update playbook', err);
      return res.status(500).json({ error: 'Failed to update playbook.' });
    }
  }
);

router.delete('/playbooks/:id', [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const deleted = await deletePlaybook(req.user.id, req.params.id);
    return res.json({ success: true, deleted });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to delete playbook', err);
    return res.status(500).json({ error: 'Failed to delete playbook.' });
  }
});

router.post('/playbooks/:id/preview', automationLimiter, [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const preview = await previewPlaybook(req.user.id, req.params.id);
    return res.json({ preview });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    logger.error('Failed to preview playbook', err);
    return res.status(500).json({ error: 'Failed to preview playbook.' });
  }
});

router.post('/playbooks/:id/run', automationLimiter, [param('id').isUUID()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const playbook = await getPlaybook(req.user.id, req.params.id);
    if (!playbook) return res.status(404).json({ error: 'Playbook not found.' });

    const run = await enqueuePlaybookRun(req.user.id, req.params.id, 'manual');
    return res.status(202).json({ run });
  } catch (err) {
    logger.error('Failed to enqueue playbook run', err);
    return res.status(500).json({ error: 'Failed to run playbook.' });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const runs = await listRuns(req.user.id, req.query.limit);
    return res.json({ runs });
  } catch (err) {
    logger.error('Failed to list playbook runs', err);
    return res.status(500).json({ error: 'Failed to list runs.' });
  }
});

router.get('/insights/domains', async (req, res) => {
  try {
    const items = await getLatestInsights(req.user.id);
    return res.json({ items });
  } catch (err) {
    logger.error('Failed to get domain insights', err);
    return res.status(500).json({ error: 'Failed to fetch insights.' });
  }
});

module.exports = router;
