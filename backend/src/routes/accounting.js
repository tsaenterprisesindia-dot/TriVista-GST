const router = require('express').Router();
const c = require('../controllers/accountingController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/purchases', authenticate, c.listPurchases);
router.post('/purchases', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT'), c.createPurchase);
router.get('/purchases/:id', authenticate, c.getPurchase);
router.post('/purchases/:id/pay', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT'), c.payPurchase);

router.get('/pnl', authenticate, c.profitLoss);
router.get('/balance-sheet', authenticate, c.balanceSheet);
router.get('/daybook', authenticate, c.dayBook);

module.exports = router;