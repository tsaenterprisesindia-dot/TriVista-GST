const router = require('express').Router();
const c = require('../controllers/recurringController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, c.list);
router.post('/', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.create);
router.put('/:id', authenticate, c.update);
router.delete('/:id', authenticate, c.remove);
router.post('/generate', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.generate);

module.exports = router;