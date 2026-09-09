const router = require('express').Router();
const c = require('../controllers/inventoryController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/stock', authenticate, c.stockOnHand);
router.get('/report', authenticate, c.stockReport);
router.get('/movements', authenticate, c.movements);
router.post('/movements', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT','STORE'), c.addMovement);

module.exports = router;