/**
 * Export utilities for interoperability with Tally / Zoho Books / Busy.
 *
 * Tally:   accepts standard CSV (Vchvouchers format) and XML (TDL/Envelope).
 * Zoho:    CSV import of invoices.
 * Busy:    CSV voucher import.
 *
 * We generate a generic "universal" CSV (Excel-friendly with BOM) plus a
 * Tally XML voucher file. All are compatible with GST-era ledgers.
 */

function escapeCsv(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers, rows) {
  const lines = [];
  lines.push(headers.map(escapeCsv).join(','));
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsv(r[h] ?? '')).join(','));
  }
  // BOM for Excel
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Invoices CSV for Zoho Books / Busy / Excel.
 */
function invoicesCsv(invoices) {
  const headers = [
    'InvoiceNo',
    'InvoiceDate',
    'DocType',
    'CustomerName',
    'CustomerGSTIN',
    'PlaceOfSupply',
    'GSTType',
    'HSNCode',
    'ItemName',
    'Quantity',
    'Unit',
    'Rate',
    'Discount',
    'TaxableValue',
    'CGST',
    'SGST',
    'UTGST',
    'IGST',
    'Cess',
    'Total',
    'InvoiceValue',
  ];
  const rows = [];
  for (const inv of invoices) {
    for (const it of inv.items || []) {
      rows.push({
        InvoiceNo: inv.invoice_number,
        InvoiceDate: inv.invoice_date,
        DocType: inv.invoice_type || '',
        CustomerName: inv.customer_name,
        CustomerGSTIN: inv.customer_gstin || '',
        PlaceOfSupply: inv.place_of_supply,
        GSTType: inv.is_interstate ? 'IGST' : 'CGST+SGST',
        HSNCode: it.hsn_code || '',
        ItemName: it.item_name,
        Quantity: it.quantity,
        Unit: it.unit,
        Rate: it.unit_price,
        Discount: it.discount,
        TaxableValue: it.taxable_value,
        CGST: it.cgst_amount,
        SGST: it.sgst_amount,
        UTGST: it.utgst_amount || 0,
        IGST: it.igst_amount,
        Cess: it.cess_amount,
        Total: it.total,
        InvoiceValue: inv.grand_total,
      });
    }
  }
  return toCsv(headers, rows);
}

/**
 * Simple general ledger CSV for Tally (Vchvouchers-style, GST aware).
 */
function ledgerCsv(transactions) {
  const headers = [
    'Date',
    'Account',
    'Debit',
    'Credit',
    'Narration',
    'Reference',
  ];
  const rows = (transactions || []).map((t) => ({
    Date: t.date,
    Account: t.account_name || '',
    Debit: t.debit,
    Credit: t.credit,
    Narration: t.narration || '',
    Reference: `${t.reference_type || ''}${t.reference_id ? '#' + t.reference_id : ''}`,
  }));
  return toCsv(headers, rows);
}

/**
 * Tally XML voucher (Sales, GST-combined). One <VOUCHER> per invoice.
 * Tally can import this via "Import XML / TDL".
 */
function tallyXml(invoices, company) {
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const parts = [];
  for (const inv of invoices) {
    const d = String(inv.invoice_date);
    const hasCgst = Number(inv.cgst_total) > 0;
    const hasIgst = Number(inv.igst_total) > 0;
    const hasUtgst = Number(inv.utgst_total) > 0;

    parts.push(`<VOUCHER><DATE>${esc(d)}</DATE><NARRATION>${esc(inv.notes || '')}</NARRATION><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(inv.invoice_number)}</VOUCHERNUMBER>`);
    parts.push(`<PARTYLEDGERNAME>${esc(inv.customer_name || 'Customer')}</PARTYLEDGERNAME>${inv.customer_gstin ? `<GSTIN>${esc(inv.customer_gstin)}</GSTIN>` : ''}`);
    for (const it of inv.items || []) {
      parts.push(`<ALLLEDGERENTRIES.LIST>`);
      parts.push(`<LEDGERNAME>${it.is_service ? 'Service Income' : 'Sales Income'}</LEDGERNAME>`);
      parts.push(`<GSTCLASS><TAXABILITY>Taxable</TAXABILITY><HSNCODE>${esc(it.hsn_code || '')}</HSNCODE><GSTDETAILS><ASSESSABLEVALUE>${it.taxable_value || 0}</ASSESSABLEVALUE><IGST>${it.igst_amount || 0}</IGST><CGST>${it.cgst_amount || 0}</CGST><SGST>${it.sgst_amount || 0}</SGST><UTGST>${it.utgst_amount || 0}</UTGST><CESS>${it.cess_amount || 0}</CESS></GSTDETAILS></GSTCLASS>`);
      parts.push(`<AMOUNT>-${it.taxable_value || 0}</AMOUNT>`);
      parts.push(`</ALLLEDGERENTRIES.LIST>`);
    }
    if (hasIgst) {
      parts.push(`<ALLLEDGERENTRIES.LIST><LEDGERNAME>GST Output (IGST Payable)</LEDGERNAME><AMOUNT>-${inv.igst_total}</AMOUNT></ALLLEDGERENTRIES.LIST>`);
    }
    if (hasUtgst) {
      parts.push(`<ALLLEDGERENTRIES.LIST><LEDGERNAME>GST Output (UTGST Payable)</LEDGERNAME><AMOUNT>-${inv.utgst_total}</AMOUNT></ALLLEDGERENTRIES.LIST>`);
    }
    if (hasCgst) {
      parts.push(`<ALLLEDGERENTRIES.LIST><LEDGERNAME>GST Output (CGST Payable)</LEDGERNAME><AMOUNT>-${inv.cgst_total}</AMOUNT></ALLLEDGERENTRIES.LIST>`);
      if (Number(inv.sgst_total) > 0) {
        parts.push(`<ALLLEDGERENTRIES.LIST><LEDGERNAME>GST Output (SGST Payable)</LEDGERNAME><AMOUNT>-${inv.sgst_total}</AMOUNT></ALLLEDGERENTRIES.LIST>`);
      }
    }
    parts.push(`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Accounts Receivable (Debtors)</LEDGERNAME><AMOUNT>${inv.grand_total}</AMOUNT></ALLLEDGERENTRIES.LIST>`);
    parts.push(`</VOUCHER>`);
  }

  return `<?xml version="1.0"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST><TYPEOF>Data</TYPEOF><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company?.company_name || 'Company')}</SVCURRENTCOMPANY></STATICVARIABLES></DESC><DATA><TALLYMESSAGE><VOUCHERMESSAGE><VOUCHERLIST>${parts.join('')}</VOUCHERLIST></VOUCHERMESSAGE></TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
}

module.exports = { toCsv, invoicesCsv, ledgerCsv, tallyXml, escapeCsv };