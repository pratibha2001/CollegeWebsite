import pg from 'pg';

pg.types.setTypeParser(1700, (v) => parseFloat(v));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });


export default pool;