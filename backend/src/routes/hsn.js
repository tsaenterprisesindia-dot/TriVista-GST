const router = require('express').Router();
const c = require('../controllers/hsnController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, c.list);
router.get('/:code/rates', authenticate, c.rates);
router.post('/rates', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.createRateChange);

module.exports = router;