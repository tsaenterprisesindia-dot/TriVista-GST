const router = require('express').Router();
const c = require('../controllers/returnController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, c.list);
router.post('/', authenticate, authorize('ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT', 'SALES'), c.createReturn);
router.get('/:id', authenticate, c.get);

module.exports = router;