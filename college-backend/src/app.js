import express from 'express';
import pool from './config/db.js';
import authRoutes from './modules/common/auth.routes.js';
import admissionRoutes from './modules/admission/admission.routes.js';


const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/health/db', async (req, res) => {
  const result = await pool.query('select count(*) from "Common"."Roles"');
  //ye query ka result show kr paara - so ye means db connection is working fine
  res.json(result.rows[0]);
});

app.use('/api/auth', authRoutes);
app.use('/api/admission', admissionRoutes);

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

export default app;