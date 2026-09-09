const router = require('express').Router();
const c = require('../controllers/hsnController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, c.list);

module.exports = router;