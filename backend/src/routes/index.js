const router = require('express').Router();

const authRoutes = require('./auth');
const productRoutes = require('./products');
const inventoryRoutes = require('./inventory');
const customerRoutes = require('./customers');
const vendorRoutes = require('./vendors');
const invoiceRoutes = require('./invoices');
const posRoutes = require('./pos');
const reportRoutes = require('./reports');
const companyRoutes = require('./company');
const hsnRoutes = require('./hsn');
const accountingRoutes = require('./accounting');
const integrationRoutes = require('./integration');
const reconciliationRoutes = require('./reconciliation');
const aiRoutes = require('./ai');
const publicApiRoutes = require('./publicApi');

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/customers', customerRoutes);
router.use('/vendors', vendorRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/pos', posRoutes);
router.use('/reports', reportRoutes);
router.use('/company', companyRoutes);
router.use('/hsn', hsnRoutes);
router.use('/accounting', accountingRoutes);
router.use('/integration', integrationRoutes);
router.use('/reconciliation', reconciliationRoutes);
router.use('/ai', aiRoutes);
router.use('/apikeys', publicApiRoutes);

module.exports = router;