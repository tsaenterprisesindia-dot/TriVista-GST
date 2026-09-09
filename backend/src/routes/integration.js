const router = require('express').Router();
const c = require('../controllers/integrationController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/einvoice', authenticate, c.einvoiceLogs);
router.post('/einvoice/:id/generate', authenticate, c.generateEinvoice);
router.post('/einvoice/:id/simulate-irn', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.simulateIrn);

router.get('/ewaybill', authenticate, c.ewaybillLogs);
router.post('/ewaybill/:id/generate', authenticate, c.generateEwaybill);

module.exports = router;