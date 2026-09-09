const router = require('express').Router();
const c = require('../controllers/publicApiController');
const { authenticate, authorize } = require('../middleware/auth');
const { apiKeyAuth } = require('../middleware/apiKey');

// Key management (internal, super admin)
router.get('/clients', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.listClients);
router.post('/clients', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.createClient);
router.post('/clients/:id/revoke', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.revokeClient);

// Public API (key auth)
router.get('/v1/products', apiKeyAuth, c.publicProducts);
router.get('/v1/invoices', apiKeyAuth, c.publicInvoices);
router.get('/v1/stock', apiKeyAuth, c.publicStock);
router.get('/v1/gst-summary', apiKeyAuth, c.publicGstSummary);

module.exports = router;