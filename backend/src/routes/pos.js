const router = require('express').Router();
const c = require('../controllers/posController');
const { authenticate } = require('../middleware/auth');

router.post('/sale', authenticate, c.posSale);

module.exports = router;