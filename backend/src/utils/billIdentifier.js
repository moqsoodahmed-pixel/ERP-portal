/**
 * Calculates Indian Financial Year string (e.g., '25-26' for April 2025 to March 2026).
 */
export function getFinancialYearString(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0 = Jan, 3 = April
  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;
  const sy = String(startYear).slice(-2);
  const ey = String(endYear).slice(-2);
  return `${sy}-${ey}`;
}

/**
 * Generates a globally unique Bill ID for an uploaded bill.
 * Format: [CompanyCode]-BILL-[FinancialYear]-[RunningNumber]
 * Example: JAC001-BILL-25-26-000001
 * 
 * Uses atomic counter scoped to tenant and financial year (or tenant) to guarantee no collisions.
 */
export async function generateBillId(counterRepo, tenantId, companyCode = 'CMP001', date = new Date()) {
  const fy = getFinancialYearString(date);
  const counterKey = `bill_seq:${fy}`;
  const seq = await counterRepo.next(tenantId, counterKey);
  const runningNumber = String(seq).padStart(6, '0');
  return `${companyCode}-BILL-${fy}-${runningNumber}`;
}
