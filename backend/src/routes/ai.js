const router = require('express').Router();
const c = require('../controllers/aiController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/insights', authenticate, c.insights);
router.post('/chat', authenticate, c.chat);
router.post('/validate', authenticate, c.validate);
router.get('/settings', authenticate, c.getSettings);
router.put('/settings', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.saveSettings);

module.exports = router;