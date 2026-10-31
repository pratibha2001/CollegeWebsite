import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

export function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Login required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: Number(payload.sub), roles: payload.roles };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export const requirePermission = (code) => async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select 1 from "Common"."UserRoles" ur
       join "Common"."RolePermissions" rp on rp."RoleId" = ur."RoleId"
       join "Common"."Permissions" p on p."PermissionId" = rp."PermissionId"
       where ur."UserId" = $1 and p."PermissionCode" = $2
         and (ur."ExpiresAt" is null or ur."ExpiresAt" > now())
       limit 1`,
      [req.user.id, code]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'Not allowed' });
    next();
  } catch (err) {
    next(err);
  }
};