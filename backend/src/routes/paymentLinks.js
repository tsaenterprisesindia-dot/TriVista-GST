const router = require('express').Router();
const c = require('../controllers/paymentLinkController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.list);
router.post('/', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.create);
router.get('/invoices', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.invoiceOptions);
router.post('/:token/mark-paid', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.markPaid);
router.post('/:token/cancel', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.cancel);

module.exports = router;