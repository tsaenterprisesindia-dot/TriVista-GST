const router = require('express').Router();
const c = require('../controllers/invoiceController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, c.list);
router.post('/', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT','SALES'), c.create);
router.get('/:id', authenticate, c.get);
router.post('/:id/pay', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT'), c.addPayment);
router.post('/:id/cancel', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.cancel);

module.exports = router;