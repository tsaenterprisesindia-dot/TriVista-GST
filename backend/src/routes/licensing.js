const router = require('express').Router();
const c = require('../controllers/licensingController');
const { authenticate, authorize } = require('../middleware/auth');

// Licensing is firm-internal sales tracking — admins only (reads included).
const admin = [authenticate, authorize('ADMIN', 'SUPER_ADMIN')];

router.get('/plans', admin, c.listPlans);
router.post('/plans', admin, c.createPlan);
router.put('/plans/:id', admin, c.updatePlan);
router.delete('/plans/:id', admin, c.deletePlan);

router.get('/stats', admin, c.stats);
router.get('/', admin, c.list);
router.get('/:id', admin, c.get);
router.post('/', admin, c.create);
router.put('/:id', admin, c.update);
router.post('/:id/renew', admin, c.renew);
router.delete('/:id', admin, c.remove);

module.exports = router;