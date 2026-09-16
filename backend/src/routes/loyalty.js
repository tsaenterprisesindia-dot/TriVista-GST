const router = require('express').Router();
const c = require('../controllers/loyaltyController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/rules', authenticate, c.getRules);
router.put('/rules', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.updateRules);
router.get('/customers/:id', authenticate, c.customerPoints);
router.post('/adjust', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.adjust);

module.exports = router;