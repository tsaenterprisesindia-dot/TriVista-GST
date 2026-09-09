const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const auditController = require('../controllers/auditController');

router.get('/', authenticate, authorize('ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT'), auditController.list);

module.exports = router;