const router = require('express').Router();
const c = require('../controllers/customerController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, c.list);
router.post('/', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT','SALES'), c.create);
router.get('/:id/history', authenticate, c.history);
router.get('/:id', authenticate, c.get);
router.put('/:id', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT','SALES'), c.update);
router.delete('/:id', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.remove);

module.exports = router;