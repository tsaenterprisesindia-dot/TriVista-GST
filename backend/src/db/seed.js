const bcrypt = require('bcryptjs');
const { getPool } = require('./index');

// --clean => masters only (company, HSN, categories, chart of accounts, admin).
// Without it, sample products + demo customers/vendors are also seeded (dev/demo mode).
const CLEAN = process.argv.includes('--clean');

async function seed() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ---- Company settings ----
    const [companyRows] = await conn.query('SELECT id FROM company_settings LIMIT 1');
    if (companyRows.length === 0) {
      await conn.query(
        `INSERT INTO company_settings
         (company_name, legal_name, trade_name, constitution, gstin, pan, tan, address_line1, city, state, state_code, pincode, phone, email, website,
          invoice_prefix, invoice_start_number, invoice_footer_note, gst_tax_preference, round_off)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          process.env.DEFAULT_COMPANY_NAME || 'TriVista Traders',
          process.env.DEFAULT_COMPANY_NAME || 'TriVista Traders',
          null,
          null,
          process.env.DEFAULT_GSTIN || '29ABCDE1234F1Z5',
          'ABCDE1234F',
          'BANG12345A',
          process.env.DEFAULT_ADDRESS || 'Shop No. 12, MG Road',
          'Bengaluru',
          'Karnataka',
          '29',
          '560001',
          '+91 98000 00000',
          'hello@trivenigst.in',
          'www.trivenigst.in',
          'INV',
          0,
          'Thank you for your business! Subject to Bengaluru jurisdiction.',
          process.env.GST_TAX_PREFERENCE || 'exclusive',
          1,
        ]
      );
      console.log('Seeded company settings.');
    }

    // ---- Admin user (if schema was created before seed) ----
    const [usersCount] = await conn.query('SELECT COUNT(*) AS c FROM users');
    if (usersCount[0].c === 0) {
      const hash = bcrypt.hashSync('Admin@123', 10);
      await conn.query(
        `INSERT INTO users (name,email,phone,password_hash,role,member_type,company_id,branch_id)
         VALUES ('TriVista Administrator','admin@triveni.local',NULL,?,'SUPER_ADMIN','COMPANY',1,1)`,
        [hash]
      );
      console.log('Seeded admin user (admin@triveni.local / Admin@123).');
    }

    // ---- Default branch (multi-company/multi-branch) ----
    const [branchCount] = await conn.query('SELECT COUNT(*) AS c FROM branches');
    if (branchCount[0].c === 0) {
      const [br] = await conn.query(
        `INSERT INTO branches (branch_name,company_name,gstin,pan,state_code,invoice_prefix,is_head_office)
         VALUES ('Head Office - TriVista','TriVista Traders','29ABCDE1234F1Z5','ABCDE1234F','29','INV',1)`
      );
      await conn.query('UPDATE company_settings SET active_branch_id=?', [br.insertId]);
      console.log('Seeded default branch.');
    }

    // ---- AI settings ----
    const [aiCount] = await conn.query('SELECT COUNT(*) AS c FROM ai_settings');
    if (aiCount[0].c === 0) {
      await conn.query(
        `INSERT INTO ai_settings (provider,model,api_key_encrypted,endpoint,is_enabled)
         VALUES ('NONE',NULL,NULL,NULL,0)`
      );
      console.log('Seeded AI settings (disabled).');
    }

    // ---- HSN / GST master (common slabs) ----
    const [hsnCount] = await conn.query('SELECT COUNT(*) AS c FROM hsn_sac_codes');
    if (hsnCount[0].c === 0) {
      const hsns = [
        ['9983', 'Professional and Business Services', 'SAC', 18, 9, 9, 18, 0],
        ['9985', 'Transportation Services', 'SAC', 5, 2.5, 2.5, 5, 0],
        ['0101', 'Live animals', 'HSN', 0, 0, 0, 0, 0],
        ['0301', 'Fish, crustaceans', 'HSN', 0, 0, 0, 0, 0],
        ['0401', 'Milk and cream', 'HSN', 0, 0, 0, 0, 0],
        ['0910', 'Ginger, turmeric & spices', 'HSN', 0, 0, 0, 0, 0],
        ['1905', 'Bakery products (bread, biscuits)', 'HSN', 18, 9, 9, 18, 0],
        ['2106', 'Food preparations', 'HSN', 18, 9, 9, 18, 0],
        ['2201', 'Waters, mineral & aerated', 'HSN', 18, 9, 9, 18, 0],
        ['3004', 'Medicaments', 'HSN', 12, 6, 6, 12, 0],
        ['3304', 'Cosmetics / skincare', 'HSN', 18, 9, 9, 18, 0],
        ['3401', 'Soap & washing preparations', 'HSN', 18, 9, 9, 18, 0],
        ['3926', 'Plastic articles', 'HSN', 18, 9, 9, 18, 0],
        ['4818', 'Toilet paper / napkins', 'HSN', 18, 9, 9, 18, 0],
        ['4820', 'Registers, exercise books', 'HSN', 12, 6, 6, 12, 0],
        ['4901', 'Printed books', 'HSN', 0, 0, 0, 0, 0],
        ['6109', 'T-shirts & vests', 'HSN', 12, 6, 6, 12, 0],
        ['6201', 'Men’s outer garments', 'HSN', 12, 6, 6, 12, 0],
        ['6301', 'Blankets & travelling rugs', 'HSN', 12, 6, 6, 12, 0],
        ['6402', 'Footwear', 'HSN', 18, 9, 9, 18, 0],
        ['6901', 'Bricks / ceramic goods', 'HSN', 28, 14, 14, 28, 0],
        ['7326', 'Iron/steel articles', 'HSN', 18, 9, 9, 18, 0],
        ['8471', 'Computers & laptops', 'HSN', 18, 9, 9, 18, 0],
        ['8517', 'Phones & telecom equipment', 'HSN', 18, 9, 9, 18, 0],
        ['8523', 'Media / memory cards', 'HSN', 18, 9, 9, 18, 0],
        ['8536', 'Electrical apparatus', 'HSN', 18, 9, 9, 18, 0],
        ['8714', 'Bicycle parts', 'HSN', 18, 9, 9, 18, 0],
        ['9403', 'Furniture', 'HSN', 18, 9, 9, 18, 0],
        ['9503', 'Toys / games', 'HSN', 18, 9, 9, 18, 0],
        ['9619', 'Sanitary napkins/tampons', 'HSN', 0, 0, 0, 0, 0],
      ];
      for (const h of hsns) {
        await conn.query(
          `INSERT INTO hsn_sac_codes (code,description,type,gst_rate,cgst_rate,sgst_rate,igst_rate,cess_rate)
           VALUES (?,?,?,?,?,?,?,?)`,
          h
        );
      }
      console.log('Seeded HSN/SAC master (' + hsns.length + ' codes).');
    }

    // ---- Categories ----
    const [catCount] = await conn.query('SELECT COUNT(*) AS c FROM categories');
    if (catCount[0].c === 0) {
      const cats = ['Groceries', 'Electronics', 'Clothing', 'Furniture', 'Toys', 'Services', 'Stationery', 'Cosmetics'];
      for (const c of cats) {
        await conn.query('INSERT INTO categories (name) VALUES (?)', [c]);
      }
      console.log('Seeded categories.');
    }

    const catMap = await getCategoryMap(conn);

    // ---- Sample products (demo mode only) ----
    const [prodCount] = await conn.query('SELECT COUNT(*) AS c FROM products');
    if (!CLEAN && prodCount[0].c === 0) {
      // sku, barcode, name, category, hsn, rate, unit, sell, purchase, mrp, min_stock, opening_stock
      const products = [
        ['SKU-0001', '8901234560011', 'Basmati Rice 5kg', catMap.Groceries, '1006', 5, 'KG', 450, 400, 480, 10, 120],
        ['SKU-0002', '8901234560028', 'Sunflower Oil 1L', catMap.Groceries, '1512', 5, 'LTR', 140, 120, 155, 20, 150],
        ['SKU-0003', '8901234560035', 'Toor Dal 1kg', catMap.Groceries, '0713', 0, 'KG', 120, 100, 130, 15, 200],
        ['SKU-0004', '8901234560042', 'Refined Sugar 1kg', catMap.Groceries, '1701', 5, 'KG', 45, 40, 48, 30, 300],
        ['SKU-0005', '8901234560059', 'Compact Keyboard', catMap.Electronics, '8471', 18, 'PCS', 799, 650, 899, 12, 50],
        ['SKU-0006', '8901234560066', 'Wireless Mouse', catMap.Electronics, '8471', 18, 'PCS', 449, 350, 499, 25, 80],
        ['SKU-0007', '8901234560073', 'LED Bulb 9W', catMap.Electronics, '8536', 18, 'PCS', 120, 90, 140, 40, 200],
        ['SKU-0008', '8901234560080', 'Cotton T-Shirt', catMap.Clothing, '6109', 12, 'PCS', 399, 300, 450, 30, 100],
        ['SKU-0009', '8901234560097', 'Office Chair', catMap.Furniture, '9403', 18, 'PCS', 4999, 4200, 5500, 5, 15],
        ['SKU-0010', '8901234560103', 'Wooden Study Table', catMap.Furniture, '9403', 18, 'PCS', 7999, 6500, 8500, 3, 8],
        ['SKU-0011', '8901234560110', 'Building Blocks Set', catMap.Toys, '9503', 18, 'PCS', 599, 450, 650, 15, 60],
        ['SKU-0012', '8901234560127', 'A4 Paper Ream', catMap.Stationery, '4802', 12, 'REAM', 250, 210, 270, 50, 120],
        ['SKU-0013', '', 'Subscription - Annual Support', catMap.Services, '9983', 18, 'YR', 12000, 0, 12000, 0, 0],
      ];
      for (const p of products) {
        const hsn = p[4] || null;
        await conn.query(
          `INSERT INTO products (sku,barcode,name,category_id,hsn_code,gst_rate,unit,selling_price,purchase_price,mrp,min_stock,is_service)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [p[0], p[1], p[2], p[3], hsn, p[5], p[6], p[7], p[8], p[9], p[10], 0]
        );
        // mark service items
        if (p[2] && p[2].toLowerCase().includes('subscription')) {
          const pid = (await conn.query('SELECT id FROM products WHERE sku=?', [p[0]]))[0][0].id;
          await conn.query('UPDATE products SET is_service=1, purchase_price=0 WHERE id=?', [pid]);
        }
        // add opening stock for physical items
        if (Number(p[11]) > 0) {
          const pid = (await conn.query('SELECT id FROM products WHERE sku=?', [p[0]]))[0][0].id;
          await conn.query(
            `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,note)
             VALUES (?,'IN',?,?,'Opening stock')`,
            [pid, p[11], p[8]]
          );
        }
      }
      console.log('Seeded sample products.');
    }

    // ---- Demo customer (demo mode only) ----
    const [custCount] = await conn.query('SELECT COUNT(*) AS c FROM customers');
    if (!CLEAN && custCount[0].c === 0) {
      await conn.query(
        `INSERT INTO customers (customer_code,name,gstin,phone,email,address_line1,city,state,state_code,pincode,opening_balance,credit_limit)
         VALUES ('CUST-0001','Walk-in Customer',NULL,NULL,NULL,'On Counter','Bengaluru','Karnataka','29','560001',0,NULL)`
      );
      await conn.query(
        `INSERT INTO customers (customer_code,name,company_name,gstin,phone,email,address_line1,city,state,state_code,pincode,opening_balance,credit_limit)
         VALUES ('CUST-0002','Rajesh Sharma','Sharma Traders','29AACFS1234F1Z2','9876501234','rajesh@sharmatraders.in','Plot 21, Industrial Area','Mysuru','Karnataka','29','570001',0,50000)`
      );
      await conn.query(
        `INSERT INTO customers (customer_code,name,company_name,gstin,phone,email,address_line1,city,state,state_code,pincode,opening_balance,credit_limit)
         VALUES ('CUST-0003','Priya Enterprises','Priya Enterprises','33ABCDE9876G1Z3','9845012345','priya@priyaent.in','Door 5, Nehru Street','Pondicherry','Puducherry','34','605001',0,100000)`
      );
      console.log('Seeded demo customers.');
    }

    // ---- Demo vendor (demo mode only) ----
    const [vendCount] = await conn.query('SELECT COUNT(*) AS c FROM vendors');
    if (!CLEAN && vendCount[0].c === 0) {
      await conn.query(
        `INSERT INTO vendors (vendor_code,name,gstin,phone,email,address_line1,city,state,state_code,pincode)
         VALUES ('VEND-0001','Karnataka Wholesale Mart','29AAACW1234F1Z4','9900112233','sales@kwmart.in','Wholesale Market Road','Hubballi','Karnataka','29','580001')`
      );
      console.log('Seeded demo vendor.');
    }

    // ---- Chart of accounts (if schema was created before seed) ----
    const [acctCount] = await conn.query('SELECT COUNT(*) AS c FROM accounts');
    if (acctCount[0].c === 0) {
      const accts = [
        ['1000','Cash','ASSET'],
        ['1100','Bank - Current Account','ASSET'],
        ['1200','Inventory Stock','ASSET'],
        ['1300','Accounts Receivable (Debtors)','ASSET'],
        ['2000','Accounts Payable (Creditors)','LIABILITY'],
        ['2100','GST Output (CGST Payable)','LIABILITY'],
        ['2200','GST Output (SGST Payable)','LIABILITY'],
        ['2300','GST Output (IGST Payable)','LIABILITY'],
        ['2400','GST Output (UTGST Payable)','LIABILITY'],
        ['3000','Capital / Owner Equity','EQUITY'],
        ['4000','Sales Income','INCOME'],
        ['4100','Service Income','INCOME'],
        ['5000','Purchase of Goods','EXPENSE'],
        ['5100','Purchase of Services','EXPENSE'],
        ['5200','Discounts Given','EXPENSE'],
        ['5300','Sales Return','EXPENSE'],
        ['5400','Bank Charges','EXPENSE'],
        ['5500','Sundry Expenses','EXPENSE'],
        ['2600','Input CGST Credit','ASSET'],
        ['2700','Input SGST Credit','ASSET'],
        ['2800','Input IGST Credit','ASSET'],
        ['2900','Input UTGST Credit','ASSET'],
        ['5600','Round Off','EXPENSE'],
      ];
      for (const a of accts) {
        await conn.query('INSERT INTO accounts (code,name,type) VALUES (?,?,?)', a);
      }
      console.log('Seeded chart of accounts.');
    }

    await conn.commit();
    console.log('Seeding complete.');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function getCategoryMap(conn) {
  const [rows] = await conn.query('SELECT id, name FROM categories');
  const m = {};
  for (const r of rows) m[r.name] = r.id;
  return m;
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    if (err && err.sql) console.error('SQL:', err.sql);
    process.exit(1);
  });