const router = require('express').Router();
const c = require('../controllers/vendorController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, c.list);
router.post('/', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT'), c.create);

module.exports = router;