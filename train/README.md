# Entrenamiento CFR (backpocket — work in progress)

`cfr.js` implementa External-Sampling MCCFR sobre el motor del truco
(reusa `legalActions`/`applyAction`, no toca nada del juego ni de la IA).

Estado actual: **no converge todavía**. La abstracción (por poder de carta +
tanto de envido) es casi sin pérdida pero demasiado fina: el historial público
genera ~1 infoset nuevo por visita (900k infosets con solo 2k iteraciones), así
que no aprende. Para que sirva hace falta **abstracción agresiva** (pocos buckets
de fuerza + compresión del historial). Queda como base para retomar.

Uso: `node train/cfr.js [iteraciones]` (genera train/strategy.json, ignorado por git).
