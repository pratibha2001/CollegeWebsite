import jwt from 'jsonwebtoken';

export const signToken = (userId, roles) =>
  jwt.sign({ roles }, process.env.JWT_SECRET, { subject: String(userId), expiresIn: '1h' });