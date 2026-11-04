const CATEGORIES = ['General', 'ObcNcl', 'Sc', 'St', 'Ews', 'Other'];

const text = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

export function parsePersonal(body) {
  const errors = [];

  const dob = new Date(body.dateOfBirth);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(body.dateOfBirth ?? '') ||
    Number.isNaN(dob.getTime()) ||
    dob <= new Date('1950-01-01') ||
    dob >= new Date()
  ) {
    errors.push('dateOfBirth must be a past date written as YYYY-MM-DD');
  }

  const guardianName = text(body.guardianName, 150);
  if (!guardianName) errors.push('guardianName is required');

  const guardianMobile = text(body.guardianMobile, 16)?.replace(/[\s-]/g, '');
  if (!guardianMobile || !/^\+?\d{10,15}$/.test(guardianMobile)) {
    errors.push('guardianMobile must be 10 to 15 digits');
  }

  const category = body.category ?? 'General';
  if (!CATEGORIES.includes(category)) {
    errors.push(`category must be one of: ${CATEGORIES.join(', ')}`);
  }

  if (errors.length > 0) return { errors };

  return {
    value: {
      dateOfBirth: body.dateOfBirth,
      gender: text(body.gender, 15),
      category,
      isPwd: body.isPwd === true,
      nationality: text(body.nationality, 2)?.toUpperCase() ?? 'IN',
      homeState: text(body.homeState, 60),
      guardianName,
      guardianRelation: text(body.guardianRelation, 20),
      guardianMobile,
      guardianEmail: text(body.guardianEmail, 150),
      addressCurrent: text(body.addressCurrent, 1000),
      addressPermanent: text(body.addressPermanent, 1000),
      needsHostel: body.needsHostel === true,
      needsTransport: body.needsTransport === true,
    },
  };
}

const LEVELS = ['Secondary', 'SeniorSecondary', 'Diploma', 'Undergraduate', 'Postgraduate', 'Other'];

export function parseAcademics(body) {
  const list = body?.records;
  if (!Array.isArray(list) || list.length === 0) {
    return { errors: ['records must be a non-empty list'] };
  }
  const errors = [];
  const seen = new Set();
  const maxYear = new Date().getFullYear() + 1;

  const value = list.map((raw, i) => {
    const r = raw ?? {};
    const at = `records[${i}]`;
    if (!LEVELS.includes(r.level)) errors.push(`${at}.level must be one of ${LEVELS.join(', ')}`);
    if (seen.has(r.level)) errors.push(`${at}.level ${r.level} is listed twice`);
    seen.add(r.level);
    if (typeof r.boardOrUniversity !== 'string' || !r.boardOrUniversity.trim()) {
      errors.push(`${at}.boardOrUniversity is required`);
    }
    const year = Number(r.yearOfPassing);
    if (!Number.isInteger(year) || year < 1980 || year > maxYear) {
      errors.push(`${at}.yearOfPassing must be between 1980 and ${maxYear}`);
    }
    const hasMarks = r.marksObtained != null || r.marksTotal != null;
    const got = Number(r.marksObtained);
    const total = Number(r.marksTotal);
    if (hasMarks && !(total > 0 && got >= 0 && got <= total)) {
      errors.push(`${at} marksObtained must be between 0 and marksTotal`);
    }
    return {
      level: r.level,
      boardOrUniversity: r.boardOrUniversity?.trim(),
      institution: r.institution?.trim() || null,
      yearOfPassing: year,
      marksObtained: hasMarks ? got : null,
      marksTotal: hasMarks ? total : null,
      percentage: hasMarks ? Math.round((got / total) * 10000) / 100 : null,
    };
  });

  if (!seen.has('Secondary')) errors.push('Class 10 (Secondary) is required');
  if (!seen.has('SeniorSecondary')) errors.push('Class 12 (SeniorSecondary) is required');
  return errors.length ? { errors } : { value };
}