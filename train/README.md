# Entrenamiento CFR (backpocket — work in progress)

`cfr.js` implementa External-Sampling MCCFR sobre el motor del truco
(reusa `legalActions`/`applyAction`, no toca nada del juego ni de la IA).

Estado actual: **no converge todavía**. La abstracción (por poder de carta +
tanto de envido) es casi sin pérdida pero demasiado fina: el historial público
genera ~1 infoset nuevo por visita (900k infosets con solo 2k iteraciones), así
que no aprende. Para que sirva hace falta **abstracción agresiva** (pocos buckets
de fuerza + compresión del historial). Queda como base para retomar.

Uso: `node train/cfr.js [iteraciones]` (genera train/strategy.json, ignorado por git).

---

# CFR del envido (entrenado y opcional)

`envido_cfr.js` resuelve el **sub-juego de envido** con CFR (ver Paper 3 del
README principal). Genera `envido_strategy.json` y `src/envido-strategy.js`.

```bash
node train/envido_cfr.js 1500000   # ~20 s, 528 infosets, imprime explotabilidad
```

La web lo usa solo si `ENVIDO_CFR = true` en `src/config.js`. Hoy está en
**false** (jugamos con la heurística, que saca más puntos contra rivales que
farolean mal); el CFR queda listo para reactivar.

---

# Analizar partidas reales (errores del bot + tendencias del rival)

## 1) Datos re-resolvibles

Desde esta versión, cada partida guarda un campo **`detail`**: el reparto
completo (las 6 cartas) y la secuencia de acciones, mano por mano. Con eso se
puede **re-resolver cada mano con el motor** (minimax exacto), cosa que el log
de texto no permite.

En la web: pestaña Jugar → **Exportar (JSON)** baja todo el historial local.

## 2) Copia central en Supabase (opcional)

Para guardar `detail` también en la base central, agregá la columna una vez:

```sql
alter table public.games add column if not exists detail jsonb;
```

(Si no la agregás, el guardado central sigue andando pero sin `detail`; el
guardado local y el export sí lo tienen.)

## 3) Bajar la data central de forma segura

La key pública del front **solo inserta** (RLS), no lee. Para leer hace falta
una **clave de servicio**, que NUNCA va al repo: se pasa por variable de entorno.

1. En Supabase → *Project Settings → API* → copiá la **`service_role` key**
   (es secreta: no la pegues en chats ni la commitees).
2. Bajá las partidas:

   ```bash
   SUPABASE_SERVICE_KEY=eyJ... node train/fetch-games.js /tmp/truco-games.json
   ```

> Si exponiste la contraseña de la base o una key de servicio alguna vez,
> **rotala** en *Settings → Database / API*.

## 4) Analizar

```bash
node train/analyze.js /tmp/truco-games.json      # (o el JSON exportado de la web)
```

Reporta: % de partidas/manos ganadas, **candidatos a error de juego de cartas**
(certificados por minimax, con la carta que ganaba), balance de envido, y
**tendencias del rival** (cuánto canta/farolea envido y truco). `sim-history.js`
genera partidas de ejemplo para probar el pipeline sin datos reales.
