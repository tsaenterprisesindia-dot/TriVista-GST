const router = require('express').Router();
const c = require('../controllers/ledgerController');
const { authenticate, authorize } = require('../middleware/auth');

const WRITE = ['ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT'];

// Chart of Accounts
router.get('/', authenticate, c.listAccounts);
router.post('/', authenticate, authorize(...WRITE), c.createAccount);
router.put('/:id', authenticate, authorize(...WRITE), c.updateAccount);
router.delete('/:id', authenticate, authorize(...WRITE), c.deleteAccount);

// Ledger reports
router.get('/ledger', authenticate, c.ledger);
router.get('/trial-balance', authenticate, c.trialBalance);
router.get('/cash-bank', authenticate, c.cashBank);

// Journal vouchers
router.get('/journal', authenticate, c.listJournal);
router.post('/journal', authenticate, authorize(...WRITE), c.createJournal);
router.delete('/journal/:id', authenticate, authorize(...WRITE), c.deleteJournal);

module.exports = router;