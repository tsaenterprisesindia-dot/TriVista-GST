const router = require('express').Router();
const c = require('../controllers/reconciliationController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, c.listReconciliations);
router.post('/import', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT'), c.importReconciliation);
router.get('/:id', authenticate, c.detailReconciliation);

module.exports = router;