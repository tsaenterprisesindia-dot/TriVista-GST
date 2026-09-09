const router = require('express').Router();
const c = require('../controllers/notificationsController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, c.list);
router.post('/read', authenticate, c.markRead);

module.exports = router;