const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const c = require('../controllers/modelController');

const admin = [authenticate, authorize('ADMIN', 'SUPER_ADMIN')];

router.get('/packs', authenticate, c.getPacks);
router.get('/features', authenticate, c.getFeatures);
router.put('/features', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), c.updateFeatures);

module.exports = router;