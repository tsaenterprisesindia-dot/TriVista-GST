const router = require('express').Router();
const c = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');

router.get('/dashboard', authenticate, c.dashboard);
router.get('/sales', authenticate, c.salesReport);
router.get('/gstr1', authenticate, c.gstr1);
router.get('/gstr1-json', authenticate, c.gstr1Json);
router.get('/gstr3b', authenticate, c.gstr3b);
router.get('/gstr9', authenticate, c.gstr9);
router.get('/gstr9c', authenticate, c.gstr9c);
router.get('/itc-register', authenticate, c.itcRegister);
router.get('/hsn-summary', authenticate, c.hsnSummary);
router.get('/tds-26q', authenticate, c.tdsReport);
router.get('/tcs-27eq', authenticate, c.tcsReport);
router.get('/trial-balance', authenticate, c.trialBalance);
router.get('/aging', authenticate, c.aging);
router.get('/export/csv', authenticate, c.exportCsv);
router.get('/export/xml', authenticate, c.exportXml);
router.get('/ca-export', authenticate, c.caExport);

module.exports = router;