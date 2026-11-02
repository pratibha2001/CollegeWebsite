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