/**
 * Capa de acceso a datos. SOLO LECTURA, siempre.
 *
 * OJO: nunca usar SET (de sesión) acá. DATABASE_URL apunta a un pooler en modo
 * transacción (PgBouncer): un SET de sesión queda pegado a la conexión física
 * compartida y "envenena" las sesiones de otros clientes — así se rompió el
 * backend en julio ("cannot execute INSERT in a read-only transaction").
 * La garantía de solo-lectura y el timeout se aplican POR TRANSACCIÓN, que
 * termina en el COMMIT y no se filtra a través del pooler.
 */
const { Pool } = require('pg');

const STATEMENT_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS || 15_000);

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 4),
  // 10 min: con 30 s, cada refresco (cache de 60 s) reabría conexiones contra el
  // pooler de Supabase y cada una pasaba por pgbouncer.get_auth.
  idleTimeoutMillis: 10 * 60_000,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => console.error('[pg] error en cliente idle:', err.message));

/** Corre una query dentro de una transacción READ ONLY con timeout propio. */
async function q(sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    // SET LOCAL sí es seguro: se revierte al terminar la transacción.
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const { rows } = await client.query(sql, params);
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Primera fila o {} — evita el `rows[0].x` que explota cuando no hay filas. */
async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || {};
}

/**
 * Envuelve una promesa de sección: si falla, la sección devuelve null y el
 * motivo queda registrado, en vez de tumbar el dashboard entero.
 */
async function seccion(nombre, fn, errores) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[seccion:${nombre}]`, err.message);
    errores[nombre] = err.message;
    return null;
  }
}

async function ping() {
  const r = await q1('SELECT 1 AS ok');
  return r.ok === 1;
}

module.exports = { pool, q, q1, seccion, ping };
