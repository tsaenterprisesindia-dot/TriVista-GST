const router = require('express').Router();
const c = require('../controllers/authController');
const { authenticate, authorize, requireSuperAdmin } = require('../middleware/auth');

router.post('/login', c.login);
router.get('/me', authenticate, c.me);
router.post('/change-password', authenticate, c.changePassword);

// User management
router.get('/users', authenticate, requireSuperAdmin, c.listUsers);
router.post('/users', authenticate, requireSuperAdmin, c.createUser);
router.put('/users/:id', authenticate, requireSuperAdmin, c.updateUser);
router.delete('/users/:id', authenticate, requireSuperAdmin, c.deleteUser);

module.exports = router;