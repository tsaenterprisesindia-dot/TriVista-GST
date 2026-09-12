const router = require('express').Router();
const b = require('../controllers/branchController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, b.list);
router.post('/', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), b.create);
router.put('/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), b.update);
router.post('/:id/activate', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), b.activate);
router.delete('/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), b.remove);

module.exports = router;