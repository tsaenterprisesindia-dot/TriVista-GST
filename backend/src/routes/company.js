const router = require('express').Router();
const c = require('../controllers/companyController');
const { authenticate, authorize, requireSuperAdmin } = require('../middleware/auth');

router.get('/', authenticate, c.getSettings);
router.put('/', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.updateSettings);
router.post('/clear-data', authenticate, requireSuperAdmin, c.clearData);
router.get('/backup', authenticate, requireSuperAdmin, c.backup);
router.get('/backups', authenticate, requireSuperAdmin, c.listBackups);
router.post('/restore', authenticate, requireSuperAdmin, c.restore);

module.exports = router;