const router = require('express').Router();
const c = require('../controllers/importController');
const { authenticate, authorize } = require('../middleware/auth');

router.post('/bulk', authenticate, authorize('ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT'), c.bulk);

module.exports = router;