const router = require('express').Router();
const c = require('../controllers/feedbackController');
const { authenticate, authorize } = require('../middleware/auth');

router.post('/', authenticate, c.create);
router.get('/', authenticate, c.list);
router.put('/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.update);
router.delete('/:id', authenticate, c.remove);

module.exports = router;