const router = require('express').Router();
const c = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');

router.get('/dashboard', authenticate, c.dashboard);
router.get('/sales', authenticate, c.salesReport);
router.get('/gstr1', authenticate, c.gstr1);
router.get('/gstr3b', authenticate, c.gstr3b);
router.get('/export/csv', authenticate, c.exportCsv);
router.get('/export/xml', authenticate, c.exportXml);

module.exports = router;