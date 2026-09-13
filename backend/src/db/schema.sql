-- ============================================================
-- TriVista GST - Database Schema (MySQL)
-- Covers: users, company, contacts, inventory, GST billing,
--         accounting, reports, and GST master data.
-- ============================================================

CREATE DATABASE IF NOT EXISTS `triveni_gst_erp`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `triveni_gst_erp`;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `ai_settings`;
DROP TABLE IF EXISTS `reconciliation_rows`;
DROP TABLE IF EXISTS `reconciliation_imports`;
DROP TABLE IF EXISTS `ewaybill_logs`;
DROP TABLE IF EXISTS `einvoice_logs`;
DROP TABLE IF EXISTS `purchase_bill_items`;
DROP TABLE IF EXISTS `purchase_bills`;
DROP TABLE IF EXISTS `api_clients`;
DROP TABLE IF EXISTS `branches`;
DROP TABLE IF EXISTS `invoice_items`;
DROP TABLE IF EXISTS `invoices`;
DROP TABLE IF EXISTS `payments`;
DROP TABLE IF EXISTS `stock_movements`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `hsn_sac_codes`;
DROP TABLE IF EXISTS `customers`;
DROP TABLE IF EXISTS `vendors`;
DROP TABLE IF EXISTS `accounts`;
DROP TABLE IF EXISTS `journal_entries`;
DROP TABLE IF EXISTS `transactions`;
DROP TABLE IF EXISTS `company_settings`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `audit_logs`;
SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- Users / Roles
-- ------------------------------------------------------------
CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  -- member_type separates master data ownership
  `member_type` ENUM('COMPANY','BRANCH') NOT NULL DEFAULT 'COMPANY',
  `company_id` INT UNSIGNED DEFAULT NULL,
  `branch_id` INT UNSIGNED DEFAULT NULL,
  `role` ENUM('SUPER_ADMIN','ADMIN','ACCOUNTANT','SALES','STORE','VIEWER') NOT NULL DEFAULT 'SALES',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `accepted_terms_at` DATETIME DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Company / Organisation profile (GST business info)
-- ------------------------------------------------------------
CREATE TABLE `company_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_name` VARCHAR(190) NOT NULL,
  `legal_name` VARCHAR(190) DEFAULT NULL,
  `trade_name` VARCHAR(190) DEFAULT NULL,
  `constitution` VARCHAR(60) DEFAULT NULL,
  `gstin` VARCHAR(15) DEFAULT NULL,
  `pan` VARCHAR(10) DEFAULT NULL,
  `tan` VARCHAR(10) DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(120) DEFAULT NULL,
  `state` VARCHAR(60) DEFAULT NULL,
  `state_code` VARCHAR(2) DEFAULT NULL,
  `pincode` VARCHAR(10) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `email` VARCHAR(190) DEFAULT NULL,
  `website` VARCHAR(190) DEFAULT NULL,
  `logo_path` VARCHAR(255) DEFAULT NULL,
  `invoice_prefix` VARCHAR(20) NOT NULL DEFAULT 'INV',
  `invoice_start_number` INT UNSIGNED NOT NULL DEFAULT 0,
  `invoice_footer_note` TEXT DEFAULT NULL,
  `bank_name` VARCHAR(190) DEFAULT NULL,
  `bank_account_no` VARCHAR(40) DEFAULT NULL,
  `bank_ifsc` VARCHAR(20) DEFAULT NULL,
  `upi_id` VARCHAR(50) DEFAULT NULL,
  `upi_beneficiary` VARCHAR(190) DEFAULT NULL,
  `gst_tax_preference` ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive',
  `round_off` TINYINT(1) NOT NULL DEFAULT 1,
  `active_branch_id` INT UNSIGNED DEFAULT NULL,
  `business_type` ENUM('retail','wholesale','services','mixed') NOT NULL DEFAULT 'mixed',
  `e_invoice_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `aggregate_turnover_crores` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `apply_tds` TINYINT(1) NOT NULL DEFAULT 0,
  `apply_tcs` TINYINT(1) NOT NULL DEFAULT 0,
  `tds_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.10,
  `tcs_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.10,
  `tds_threshold` DECIMAL(14,2) NOT NULL DEFAULT 5000000.00,
  `tcs_threshold` DECIMAL(14,2) NOT NULL DEFAULT 5000000.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- UPI / shareable payment collection links
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payment_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token` CHAR(32) NOT NULL,
  `invoice_id` INT UNSIGNED DEFAULT NULL,
  `amount` DECIMAL(14,2) DEFAULT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('active','paid','cancelled') NOT NULL DEFAULT 'active',
  `paid_at` TIMESTAMP NULL DEFAULT NULL,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paylink_token` (`token`),
  KEY `idx_paylink_invoice` (`invoice_id`),
  KEY `idx_paylink_status` (`status`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- HSN / SAC Master (GST classification & rates)
-- ------------------------------------------------------------
-- ------------------------------------------------------------
-- Per-financial-year invoice series (Rule 46 fresh series per FY)
-- ------------------------------------------------------------
CREATE TABLE `invoice_series` (
  `branch_id` INT UNSIGNED NOT NULL,
  `fy` VARCHAR(6) NOT NULL,
  `series_type` VARCHAR(20) NOT NULL DEFAULT 'SALES',
  `last_number` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`branch_id`,`fy`,`series_type`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- HSN / SAC Master (GST classification & rates)
-- ------------------------------------------------------------
CREATE TABLE `hsn_sac_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(20) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `type` ENUM('HSN','SAC') NOT NULL DEFAULT 'HSN',
  `gst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `cgst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `sgst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `igst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `cess_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hsn_code` (`code`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Product Categories
-- ------------------------------------------------------------
CREATE TABLE `categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cat_name` (`name`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Products / Services (with HSN and GST)
-- ------------------------------------------------------------
CREATE TABLE `products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sku` VARCHAR(60) DEFAULT NULL,
  `barcode` VARCHAR(60) DEFAULT NULL,
  `name` VARCHAR(190) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `category_id` INT UNSIGNED DEFAULT NULL,
  `hsn_id` INT UNSIGNED DEFAULT NULL,
  `hsn_code` VARCHAR(20) DEFAULT NULL,
  `gst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `unit` VARCHAR(30) DEFAULT 'PCS',
  `selling_price` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `wholesale_price` DECIMAL(14,2) DEFAULT NULL,
  `purchase_price` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `mrp` DECIMAL(14,2) DEFAULT NULL,
  `min_stock` DECIMAL(14,2) DEFAULT NULL,
  `weight_kg` DECIMAL(10,3) DEFAULT NULL,
  `is_service` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sku` (`sku`),
  KEY `idx_product_barcode` (`barcode`),
  KEY `idx_product_category` (`category_id`),
  CONSTRAINT `fk_product_category` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_product_hsn` FOREIGN KEY (`hsn_id`) REFERENCES `hsn_sac_codes`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Stock / Inventory ()
-- ------------------------------------------------------------
CREATE TABLE `stock_movements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `type` ENUM('IN','OUT','ADJUST') NOT NULL,
  `quantity` DECIMAL(14,2) NOT NULL,
  `unit_cost` DECIMAL(14,2) DEFAULT NULL,
  `reference_type` VARCHAR(40) DEFAULT NULL,
  `reference_id` INT UNSIGNED DEFAULT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_stock_product` (`product_id`),
  CONSTRAINT `fk_stock_product` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Customers / Parties
-- ------------------------------------------------------------
CREATE TABLE `customers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_code` VARCHAR(40) DEFAULT NULL,
  `name` VARCHAR(190) NOT NULL,
  `legal_name` VARCHAR(190) NOT NULL,
  `company_name` VARCHAR(190) DEFAULT NULL,
  `gstin` VARCHAR(15) DEFAULT NULL,
  `registration_category` VARCHAR(20) DEFAULT NULL,
  `tax_exempt` TINYINT(1) NOT NULL DEFAULT 0,
  `pan` VARCHAR(10) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `email` VARCHAR(190) DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(120) DEFAULT NULL,
  `state` VARCHAR(60) DEFAULT NULL,
  `state_code` VARCHAR(2) DEFAULT NULL,
  `pincode` VARCHAR(10) DEFAULT NULL,
  `opening_balance` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `outstanding_balance` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `credit_limit` DECIMAL(14,2) DEFAULT NULL,
  `tds_rate` DECIMAL(5,2) DEFAULT NULL,
  `tcs_rate` DECIMAL(5,2) DEFAULT NULL,
  `tds_threshold` DECIMAL(14,2) DEFAULT NULL,
  `tcs_threshold` DECIMAL(14,2) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_code` (`customer_code`),
  KEY `idx_customer_gstin` (`gstin`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Vendors / Suppliers
-- ------------------------------------------------------------
CREATE TABLE `vendors` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vendor_code` VARCHAR(40) DEFAULT NULL,
  `name` VARCHAR(190) NOT NULL,
  `company_name` VARCHAR(190) DEFAULT NULL,
  `legal_name` VARCHAR(190) NOT NULL,
  `gstin` VARCHAR(15) DEFAULT NULL,
  `registration_category` VARCHAR(20) DEFAULT NULL,
  `tax_exempt` TINYINT(1) NOT NULL DEFAULT 0,
  `rcm_default` TINYINT(1) NOT NULL DEFAULT 0,
  `pan` VARCHAR(10) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `email` VARCHAR(190) DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(120) DEFAULT NULL,
  `state` VARCHAR(60) DEFAULT NULL,
  `state_code` VARCHAR(2) DEFAULT NULL,
  `pincode` VARCHAR(10) DEFAULT NULL,
  `opening_balance` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tds_rate` DECIMAL(5,2) DEFAULT NULL,
  `tds_threshold` DECIMAL(14,2) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_code` (`vendor_code`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Chart of Accounts (simplified ERP accounting)
-- ------------------------------------------------------------
CREATE TABLE `accounts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(190) NOT NULL,
  `type` ENUM('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE') NOT NULL,
  `parent_id` INT UNSIGNED DEFAULT NULL,
  `opening_balance` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_account_code` (`code`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Journal entries (double-entry voucher headers)
-- ------------------------------------------------------------
CREATE TABLE `journal_entries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `voucher_no` VARCHAR(60) NOT NULL,
  `voucher_date` DATE NOT NULL,
  `narration` VARCHAR(255) DEFAULT NULL,
  `source` ENUM('JOURNAL','INVOICE','PURCHASE','PAYMENT','REVERSAL','OPENING') NOT NULL DEFAULT 'JOURNAL',
  `ref_type` VARCHAR(40) DEFAULT NULL,
  `ref_id` INT UNSIGNED DEFAULT NULL,
  `status` ENUM('POSTED','VOID') NOT NULL DEFAULT 'POSTED',
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_voucher_no` (`voucher_no`),
  KEY `idx_je_date` (`voucher_date`),
  KEY `idx_je_ref` (`ref_type`, `ref_id`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- General ledger transactions
-- ------------------------------------------------------------
CREATE TABLE `transactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `journal_id` INT UNSIGNED DEFAULT NULL,
  `voucher_no` VARCHAR(60) DEFAULT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `date` DATE NOT NULL,
  `debit` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `credit` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `narration` VARCHAR(255) DEFAULT NULL,
  `reference_type` VARCHAR(40) DEFAULT NULL,
  `reference_id` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_txn_account` (`account_id`),
  KEY `idx_txn_date` (`date`),
  KEY `idx_txn_journal` (`journal_id`),
  KEY `idx_txn_voucher` (`voucher_no`),
  CONSTRAINT `fk_txn_account` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
  CONSTRAINT `fk_txn_journal` FOREIGN KEY (`journal_id`) REFERENCES `journal_entries`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Invoices (Sales with GST splitting)
-- ------------------------------------------------------------
CREATE TABLE `invoices` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_number` VARCHAR(60) NOT NULL,
  `invoice_date` DATE NOT NULL,
  `due_date` DATE DEFAULT NULL,
  `customer_id` INT UNSIGNED NOT NULL,
  `customer_name` VARCHAR(190) DEFAULT NULL,
  `customer_gstin` VARCHAR(15) DEFAULT NULL,
  `invoice_type` ENUM('B2B','B2C','CREDIT_NOTE','DEBIT_NOTE','EXPORT','NIL') NOT NULL DEFAULT 'B2C',
  `place_of_supply` VARCHAR(2) DEFAULT NULL,
  `is_interstate` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('DRAFT','PENDING','PAID','PARTIAL','CANCELLED','RETURNED') NOT NULL DEFAULT 'PENDING',
  `subtotal` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `discount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cgst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `sgst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `utgst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `igst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cess_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `round_off` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `grand_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `paid_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `balance_due` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `payment_mode` ENUM('CASH','CARD','UPI','BANK','CREDIT','OTHER') DEFAULT 'CREDIT',
  `tcs_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `notes` TEXT DEFAULT NULL,
  `irn` VARCHAR(64) DEFAULT NULL,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_number` (`invoice_number`),
  KEY `idx_invoice_customer` (`customer_id`),
  KEY `idx_invoice_date` (`invoice_date`),
  CONSTRAINT `fk_invoice_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Invoice line items
-- ------------------------------------------------------------
CREATE TABLE `invoice_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_id` INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED DEFAULT NULL,
  `item_name` VARCHAR(190) NOT NULL,
  `hsn_code` VARCHAR(20) DEFAULT NULL,
  `gst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `quantity` DECIMAL(14,2) NOT NULL DEFAULT 1.00,
  `unit` VARCHAR(30) DEFAULT 'PCS',
  `unit_price` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `discount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `taxable_value` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cgst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `sgst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `utgst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `igst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cess_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_invitem_invoice` (`invoice_id`),
  CONSTRAINT `fk_invitem_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Payments / receipts
-- ------------------------------------------------------------
CREATE TABLE `payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_id` INT UNSIGNED DEFAULT NULL,
  `bill_id` INT UNSIGNED DEFAULT NULL,
  `customer_id` INT UNSIGNED DEFAULT NULL,
  `date` DATE NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `mode` ENUM('CASH','CARD','UPI','BANK','OTHER') NOT NULL DEFAULT 'CASH',
  `reference_no` VARCHAR(60) DEFAULT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pay_invoice` (`invoice_id`),
  KEY `idx_pay_bill` (`bill_id`),
  KEY `idx_pay_customer` (`customer_id`),
  CONSTRAINT `fk_pay_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pay_bill` FOREIGN KEY (`bill_id`) REFERENCES `purchase_bills`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Companies & Branches (Multi-company / Multi-branch support)
-- `company_settings` holds the ACTIVE branch's printable profile.
-- `branches` lists all branches of all companies.
-- ------------------------------------------------------------
CREATE TABLE `branches` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_name` VARCHAR(190) NOT NULL,
  `company_name` VARCHAR(190) DEFAULT NULL,
  `gstin` VARCHAR(15) DEFAULT NULL,
  `pan` VARCHAR(10) DEFAULT NULL,
  `address_line1` VARCHAR(255) DEFAULT NULL,
  `address_line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(120) DEFAULT NULL,
  `state` VARCHAR(60) DEFAULT NULL,
  `state_code` VARCHAR(2) DEFAULT NULL,
  `pincode` VARCHAR(10) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `email` VARCHAR(190) DEFAULT NULL,
  `invoice_prefix` VARCHAR(20) NOT NULL DEFAULT 'INV',
  `invoice_start_number` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_head_office` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_branch_name` (`branch_name`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- API clients (for third-party / public REST APIs)
-- ------------------------------------------------------------
CREATE TABLE `api_clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_name` VARCHAR(120) NOT NULL,
  `api_key` VARCHAR(64) NOT NULL,
  `scopes` VARCHAR(255) DEFAULT 'read',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_api_key` (`api_key`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Purchase Bills (inward supplies - GST purchase accounting)
-- ------------------------------------------------------------
CREATE TABLE `purchase_bills` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bill_number` VARCHAR(60) NOT NULL,
  `bill_date` DATE NOT NULL,
  `due_date` DATE DEFAULT NULL,
  `vendor_id` INT UNSIGNED NOT NULL,
  `vendor_name` VARCHAR(190) DEFAULT NULL,
  `vendor_gstin` VARCHAR(15) DEFAULT NULL,
  `place_of_supply` VARCHAR(2) DEFAULT NULL,
  `is_interstate` TINYINT(1) NOT NULL DEFAULT 0,
  `is_rcm` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('PENDING','PARTIAL','PAID','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `subtotal` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `discount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cgst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `sgst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `utgst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `igst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cess_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tax_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `grand_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `paid_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `balance_due` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `tds_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `notes` TEXT DEFAULT NULL,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_purchase_bill_number` (`bill_number`),
  KEY `idx_purchase_vendor` (`vendor_id`),
  CONSTRAINT `fk_purchase_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`)
) ENGINE=InnoDB;

CREATE TABLE `purchase_bill_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bill_id` INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED DEFAULT NULL,
  `item_name` VARCHAR(190) NOT NULL,
  `hsn_code` VARCHAR(20) DEFAULT NULL,
  `gst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `quantity` DECIMAL(14,2) NOT NULL DEFAULT 1.00,
  `unit` VARCHAR(30) DEFAULT 'PCS',
  `unit_price` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `discount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `taxable_value` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cgst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `sgst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `utgst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `igst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cess_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pbitem_bill` (`bill_id`),
  CONSTRAINT `fk_pbitem_bill` FOREIGN KEY (`bill_id`) REFERENCES `purchase_bills`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- e-Invoice logs (IRN generation & GSTN sandbox bridging)
-- ------------------------------------------------------------
CREATE TABLE `einvoice_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_id` INT UNSIGNED NOT NULL,
  `irn` VARCHAR(64) DEFAULT NULL,
  `ack_number` VARCHAR(64) DEFAULT NULL,
  `ack_date` DATETIME DEFAULT NULL,
  `qr_url` TEXT DEFAULT NULL,
  `signed_invoice` JSON DEFAULT NULL,
  `status` ENUM('PENDING','GENERATED','FAILED') NOT NULL DEFAULT 'PENDING',
  `raw_request` JSON DEFAULT NULL,
  `raw_response` JSON DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_einv_invoice` (`invoice_id`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- e-Way Bill logs
-- ------------------------------------------------------------
CREATE TABLE `ewaybill_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_id` INT UNSIGNED DEFAULT NULL,
  `ewb_no` VARCHAR(30) DEFAULT NULL,
  `distance` INT UNSIGNED DEFAULT NULL,
  `transporter_name` VARCHAR(190) DEFAULT NULL,
  `vehicle_no` VARCHAR(30) DEFAULT NULL,
  `status` ENUM('PENDING','GENERATED','FAILED') NOT NULL DEFAULT 'PENDING',
  `raw_request` JSON DEFAULT NULL,
  `raw_response` JSON DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ewb_invoice` (`invoice_id`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- GST reconciliation (GSTR-2B / Purchase register uploads)
-- ------------------------------------------------------------
CREATE TABLE `reconciliation_imports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `period` VARCHAR(7) NOT NULL,
  `file_name` VARCHAR(190) DEFAULT NULL,
  `source` ENUM('GSTR2B','UPLOAD_SHEET','MANUAL') NOT NULL DEFAULT 'MANUAL',
  `total_records` INT UNSIGNED NOT NULL DEFAULT 0,
  `matched` INT UNSIGNED NOT NULL DEFAULT 0,
  `mismatched` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `reconciliation_rows` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `import_id` INT UNSIGNED NOT NULL,
  `supplier_gstin` VARCHAR(15) DEFAULT NULL,
  `supplier_name` VARCHAR(190) DEFAULT NULL,
  `invoice_no` VARCHAR(60) DEFAULT NULL,
  `invoice_date` DATE DEFAULT NULL,
  `taxable_value` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `gst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('MATCHED','MISMATCH','NOT_FOUND') NOT NULL DEFAULT 'NOT_FOUND',
  `matched_bill_id` INT UNSIGNED DEFAULT NULL,
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recon_import` (`import_id`),
  CONSTRAINT `fk_recon_import` FOREIGN KEY (`import_id`) REFERENCES `reconciliation_imports`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Recurring / subscription invoices (Services)
-- ------------------------------------------------------------
CREATE TABLE `recurring_invoices` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NOT NULL,
  `customer_name` VARCHAR(190) DEFAULT NULL,
  `customer_gstin` VARCHAR(15) DEFAULT NULL,
  `title` VARCHAR(190) NOT NULL,
  `hsn_code` VARCHAR(20) DEFAULT NULL,
  `gst_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `unit` VARCHAR(30) DEFAULT 'PCS',
  `quantity` DECIMAL(14,2) NOT NULL DEFAULT 1.00,
  `unit_price` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `frequency` ENUM('MONTHLY','HALF_YEARLY','QUARTERLY','YEARLY') NOT NULL DEFAULT 'MONTHLY',
  `next_run_date` DATE NOT NULL,
  `last_run_date` DATE DEFAULT NULL,
  `payment_mode` ENUM('CREDIT','CASH','CARD','UPI','BANK') NOT NULL DEFAULT 'CREDIT',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recurring_cust` (`customer_id`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- AI assistant settings + prompt history (pluggable LLM or rules)
-- ------------------------------------------------------------
CREATE TABLE `ai_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider` ENUM('NONE','OPENAI','GEMINI','AZURE') NOT NULL DEFAULT 'NONE',
  `model` VARCHAR(100) DEFAULT NULL,
  `api_key_encrypted` TEXT DEFAULT NULL,
  `endpoint` VARCHAR(300) DEFAULT NULL,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Audit log
-- ------------------------------------------------------------
CREATE TABLE `audit_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity` VARCHAR(60) DEFAULT NULL,
  `entity_id` INT UNSIGNED DEFAULT NULL,
  `details` JSON DEFAULT NULL,
  `ip` VARCHAR(45) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_user` (`user_id`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Notifications (in-app alerts: receivables, payables, stock)
-- ------------------------------------------------------------
CREATE TABLE `notifications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(40) NOT NULL,
  `reference_id` INT UNSIGNED DEFAULT NULL,
  `title` VARCHAR(190) NOT NULL,
  `message` VARCHAR(500) DEFAULT NULL,
  `severity` ENUM('info','warning','important') NOT NULL DEFAULT 'info',
  `link` VARCHAR(190) DEFAULT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notif_type_ref` (`type`,`reference_id`),
  KEY `idx_notif_read` (`is_read`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Support / feedback center: suggestions, feedback, comments,
-- complaints, requests and technical support from CAs & users
-- ------------------------------------------------------------
CREATE TABLE `support_messages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category` ENUM('SUGGESTION','FEEDBACK','COMMENT','COMPLAINT','REQUEST','TECHNICAL_SUPPORT','OTHER') NOT NULL,
  `subject` VARCHAR(200) NOT NULL,
  `message` TEXT NOT NULL,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `user_name` VARCHAR(120) DEFAULT NULL,
  `user_email` VARCHAR(190) DEFAULT NULL,
  `status` ENUM('NEW','OPEN','IN_PROGRESS','RESOLVED','CLOSED') NOT NULL DEFAULT 'NEW',
  `reply` TEXT DEFAULT NULL,
  `replied_by` INT UNSIGNED DEFAULT NULL,
  `replied_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_support_user` (`user_id`),
  KEY `idx_support_status` (`status`),
  KEY `idx_support_category` (`category`)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Licensing & subscriptions: plan catalog, client licenses,
-- renewal history (used by the firm to sell this ERP)
-- ------------------------------------------------------------
CREATE TABLE `license_plans` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `type` ENUM('TRIAL','SUBSCRIPTION','ONETIME','LIFETIME') NOT NULL,
  `duration_days` INT UNSIGNED DEFAULT NULL,
  `price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `seats` INT UNSIGNED NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_plans_type` (`type`)
) ENGINE=InnoDB;

CREATE TABLE `client_licenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id` INT UNSIGNED DEFAULT NULL,
  `client_name` VARCHAR(160) NOT NULL,
  `contact_person` VARCHAR(120) DEFAULT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `email` VARCHAR(190) DEFAULT NULL,
  `gstin` VARCHAR(15) DEFAULT NULL,
  `start_date` DATE NOT NULL,
  `expiry_date` DATE DEFAULT NULL,
  `status` ENUM('TRIAL','ACTIVE','EXPIRED','PAST_DUE','CANCELLED') NOT NULL DEFAULT 'TRIAL',
  `seats` INT UNSIGNED NOT NULL DEFAULT 1,
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `paid_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `payment_status` ENUM('UNPAID','PARTIAL','PAID') NOT NULL DEFAULT 'UNPAID',
  `payment_method` VARCHAR(60) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `invoice_id` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lic_client` (`client_name`),
  KEY `idx_lic_status` (`status`),
  KEY `idx_lic_expiry` (`expiry_date`),
  KEY `idx_lic_invoice` (`invoice_id`),
  CONSTRAINT `fk_lic_plan` FOREIGN KEY (`plan_id`) REFERENCES `license_plans` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE `license_renewals` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `license_id` INT UNSIGNED NOT NULL,
  `plan_id` INT UNSIGNED DEFAULT NULL,
  `from_date` DATE DEFAULT NULL,
  `to_date` DATE DEFAULT NULL,
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `paid_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `payment_status` ENUM('UNPAID','PARTIAL','PAID') NOT NULL DEFAULT 'UNPAID',
  `payment_method` VARCHAR(60) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lr_license` (`license_id`),
  CONSTRAINT `fk_lr_license` FOREIGN KEY (`license_id`) REFERENCES `client_licenses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO `license_plans` (`name`,`type`,`duration_days`,`price`,`seats`,`is_active`) VALUES
  ('Free Trial - 30 Days','TRIAL',30,0.00,1,1),
  ('Monthly Subscription','SUBSCRIPTION',30,500.00,1,1),
  ('Yearly Subscription','SUBSCRIPTION',365,5000.00,1,1),
  ('One-Time Lifetime License','LIFETIME',NULL,15000.00,1,1);

-- ============================================================
-- Seed: default admin user & default chart of accounts
-- Password for admin is: Admin@123
-- ============================================================
INSERT INTO `branches` (`branch_name`,`company_name`,`gstin`,`pan`,`state_code`,`invoice_prefix`,`is_head_office`)
VALUES ('Head Office - TriVista','TriVista Traders','29ABCDE1234F1Z5','ABCDE1234F','29','INV',1);

INSERT INTO `users` (`name`,`email`,`phone`,`password_hash`,`role`,`member_type`,`company_id`,`branch_id`)
VALUES ('TriVista Administrator','admin@triveni.local',NULL,
  '$2a$10$do8JX4S2EkO5jvTwj.aLG..1UpU1mDdMVFgHyEqxR/ewxLjclZoeu','SUPER_ADMIN','COMPANY',1,1);

INSERT INTO `ai_settings` (`provider`,`model`,`api_key_encrypted`,`endpoint`,`is_enabled`)
VALUES ('NONE',NULL,NULL,NULL,0);

INSERT INTO `accounts` (`code`,`name`,`type`) VALUES
  ('1000','Cash','ASSET'),
  ('1100','Bank - Current Account','ASSET'),
  ('1200','Inventory Stock','ASSET'),
  ('1300','Accounts Receivable (Debtors)','ASSET'),
  ('2000','Accounts Payable (Creditors)','LIABILITY'),
  ('2100','GST Output (CGST Payable)','LIABILITY'),
  ('2200','GST Output (SGST Payable)','LIABILITY'),
  ('2300','GST Output (IGST Payable)','LIABILITY'),
  ('2400','GST Output (UTGST Payable)','LIABILITY'),
  ('3000','Capital / Owner Equity','EQUITY'),
  ('4000','Sales Income','INCOME'),
  ('4100','Service Income','INCOME'),
  ('5000','Purchase of Goods','EXPENSE'),
  ('5100','Purchase of Services','EXPENSE'),
  ('5200','Discounts Given','EXPENSE'),
  ('5300','Sales Return','EXPENSE'),
  ('5400','Bank Charges','EXPENSE'),
  ('5500','Sundry Expenses','EXPENSE'),
  ('2600','Input CGST Credit','ASSET'),
  ('2700','Input SGST Credit','ASSET'),
  ('2800','Input IGST Credit','ASSET'),
  ('2900','Input UTGST Credit','ASSET'),
  ('5600','Round Off','EXPENSE');
