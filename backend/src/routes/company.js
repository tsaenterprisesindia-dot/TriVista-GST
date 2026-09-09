const router = require('express').Router();
const c = require('../controllers/companyController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, c.getSettings);
router.put('/', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.updateSettings);

module.exports = router;