// Descarga las partidas centrales de Supabase para analizarlas con analyze.js.
//
// SEGURIDAD: la lectura requiere una clave de SERVICIO (service_role) o un token
// con permiso de SELECT. NUNCA va hardcodeada ni al repo: se pasa por variable
// de entorno. La key pública del front solo puede INSERTAR (RLS), no leer.
//
//   SUPABASE_SERVICE_KEY=xxxxx node train/fetch-games.js [archivo.json]
//
import { writeFileSync } from 'node:fs';

const URL_BASE = 'https://ylhkxbapzoivpouydorw.supabase.co';
const TABLE = 'games';
const KEY = process.env.SUPABASE_SERVICE_KEY;
const OUT = process.argv[2] || '/tmp/truco-games.json';

if (!KEY) {
  console.error('Falta SUPABASE_SERVICE_KEY (clave de servicio de Supabase).');
  console.error('Ejemplo: SUPABASE_SERVICE_KEY=eyJ... node train/fetch-games.js datos.json');
  process.exit(1);
}

// Trae todo en páginas de 1000 (límite por request de PostgREST).
async function fetchAll() {
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const res = await fetch(`${URL_BASE}/rest/v1/${TABLE}?select=*&order=created_at.asc`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${to}`,
        Prefer: 'count=exact',
      },
    });
    if (!res.ok) {
      console.error(`Error ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

// Mapea el formato de la base al que espera analyze.js.
function toAnalyzerFormat(rows) {
  return rows.map((r) => ({
    ts: r.created_at ? new Date(r.created_at).getTime() : null,
    me: r.score_me,
    ai: r.score_ai,
    won: r.won, // true => ganó el humano
    log: r.log,
    detail: r.detail || [],
  }));
}

const rows = await fetchAll();
const data = toAnalyzerFormat(rows);
writeFileSync(OUT, JSON.stringify(data, null, 2));
const withDetail = data.filter((g) => g.detail && g.detail.length).length;
console.log(`Descargadas ${data.length} partidas en ${OUT} (${withDetail} con detalle re-resolvible).`);
console.log(`Analizá con:  node train/analyze.js ${OUT}`);
