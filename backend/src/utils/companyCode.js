const LEGAL_SUFFIX_REGEX = /\b(pvt|ltd|private|limited|llc|llp|inc|corp|corporation)\b\.?/gi;

/**
 * Extracts a 3-character uppercase prefix for a company code from an organization name.
 * 
 * Rules:
 * 1. Strips legal entity suffixes (Pvt, Ltd, Private, Limited, LLC, LLP, Inc, Corp).
 * 2. If 3 or more significant words exist (e.g. "Global Tech Solutions"), takes the first letter of each of the first 3 words -> "GTS".
 * 3. If 1 or 2 significant words exist (e.g. "Jacobella Technologies", "DutyLaunch Solutions", "ABC Industries"),
 *    takes the first 3 letters of the first word -> "JAC", "DUT", "ABC".
 * 4. Normalizes to uppercase, guarantees exactly 3 alphanumeric characters.
 */
export function extractCompanyCodePrefix(businessName = '') {
  if (!businessName || typeof businessName !== 'string') {
    return 'CMP';
  }

  // Remove legal entity suffixes
  const cleaned = businessName.replace(LEGAL_SUFFIX_REGEX, '').trim();

  // Extract alphanumeric words
  const words = cleaned.split(/[^a-zA-Z0-9]+/).filter((w) => w.length > 0);

  if (words.length >= 3) {
    const acronym = words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
    if (acronym.length === 3) return acronym;
  }

  if (words.length > 0) {
    const firstWord = words[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (firstWord.length >= 3) {
      return firstWord.slice(0, 3);
    }
    // If first word has < 3 chars, combine with following words or pad with 'X'
    let combined = firstWord;
    for (let i = 1; i < words.length && combined.length < 3; i++) {
      combined += words[i].toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    return combined.padEnd(3, 'X').slice(0, 3);
  }

  return 'CMP';
}

/**
 * Generates the permanent Company Code for an organization.
 * Format: [PREFIX][3-digit sequence] (e.g., JAC001, DUT001, GTS001, ABC001)
 * If the prefix already exists, increments to 002, 003, etc.
 * Uses atomic counter to guarantee zero collisions and no reuse even on deletion.
 */
export async function generateCompanyCode(counterRepo, tenantRepo, businessName) {
  const prefix = extractCompanyCodePrefix(businessName);
  const counterKey = `company_code:${prefix}`;

  // Next sequence number from atomic counter
  let seq = await counterRepo.next(null, counterKey);

  // Safeguard: Check if this code already exists in DB (e.g., from initial seeds or pre-existing tenants)
  let code = `${prefix}${String(seq).padStart(3, '0')}`;
  if (tenantRepo?.model?.findOne) {
    let check = tenantRepo.model.findOne({ $or: [{ companyCode: code }, { tenantCode: code }] });
    let existing = check && typeof check.lean === 'function' ? await check.lean() : await check;
    while (existing) {
      seq = await counterRepo.next(null, counterKey);
      code = `${prefix}${String(seq).padStart(3, '0')}`;
      check = tenantRepo.model.findOne({ $or: [{ companyCode: code }, { tenantCode: code }] });
      existing = check && typeof check.lean === 'function' ? await check.lean() : await check;
    }
  }

  return code;
}
