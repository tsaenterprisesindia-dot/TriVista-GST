/**
 * Discount approval-limit policy.
 *
 * Company setting discount_limit_pct sets the maximum total discount
 * (as % of the gross taxable value) that staff roles (non-admin) may apply
 * on a sales document. ADMIN / SUPER_ADMIN act as the approver and may
 * exceed the limit. A limit of 0 or null disables the control.
 *
 * Throws a 403 with an actionable message when the cap is exceeded.
 */
function enforceDiscountLimit({ user, company, subtotal, discount }) {
  const limit = Number(company && company.discount_limit_pct) || 0;
  if (limit <= 0) return;
  if (user && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN')) return;
  const base = Math.abs(Number(subtotal) || 0);
  if (base <= 0) return;
  const pct = (Math.abs(Number(discount) || 0) / base) * 100;
  if (pct > limit + 1e-9) {
    throw Object.assign(
      new Error(
        `Discount of ${pct.toFixed(2)}% exceeds the staff approval limit of ${limit}%. Reduce the discount or ask an administrator to raise/approve it.`
      ),
      { status: 403, expose: true }
    );
  }
}

module.exports = { enforceDiscountLimit };