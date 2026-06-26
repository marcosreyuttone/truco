// Envío del historial de partidas a Supabase (central, de todos los jugadores).
//
// Sólo se usan datos PÚBLICOS por diseño: la URL del proyecto y la
// "publishable key". La seguridad real la da Row Level Security (RLS) en la
// base: el anónimo sólo puede INSERTAR, no leer. (La contraseña de la base y la
// cadena postgresql:// son secretas y NO van acá.)
//
// La data se guarda igual en localStorage (historial propio); esto sólo agrega
// la copia central. Si no hay red o no está configurado, no rompe nada.

const SUPABASE_URL = 'https://ylhkxbapzoivpouydorw.supabase.co';
const SUPABASE_KEY = 'sb_publishable__445cSpSIQTJ2fSk1lJa-w_CwSolIYM';
const TABLE = 'games';

export function isRemoteEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

// Identificador anónimo por navegador, para agrupar partidas por jugador
// sin pedir login.
export function playerId() {
  try {
    let id = localStorage.getItem('truco-player-id');
    if (!id) {
      id =
        (crypto.randomUUID && crypto.randomUUID()) ||
        'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('truco-player-id', id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

async function post(record) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(record),
  });
  return res.ok; // 4xx (p. ej. columna inexistente) => false, no tira
}

// Envía una partida terminada. Fire-and-forget: nunca tira error hacia afuera.
// Robusto: si la columna `detail` todavía no existe en la base, reintenta sin
// ella para no perder la partida (los campos core sí se guardan siempre).
export async function pushGame(record) {
  if (!isRemoteEnabled()) return;
  try {
    const ok = await post(record);
    if (!ok && record && record.detail !== undefined) {
      const { detail, ...core } = record;
      await post(core);
    }
  } catch {
    /* sin conexión: ya quedó guardado en localStorage */
  }
}
