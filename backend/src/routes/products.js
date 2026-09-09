const router = require('express').Router();
const c = require('../controllers/productController');
const { authenticate, authorize } = require('../middleware/auth');

// Categories (must come before /:id routes)
router.get('/categories', authenticate, c.listCategories);
router.post('/categories', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.createCategory);

router.get('/', authenticate, c.list);
router.post('/', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT'), c.create);
router.get('/:id', authenticate, c.get);
router.put('/:id', authenticate, authorize('ADMIN','SUPER_ADMIN','ACCOUNTANT'), c.update);
router.delete('/:id', authenticate, authorize('ADMIN','SUPER_ADMIN'), c.remove);

module.exports = router;