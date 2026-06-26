// Interruptor para mostrar/ocultar el "cómo piensa" de la IA.
//
// Cuando está en false se ocultan:
//   - el panel de razonamiento de la máquina (P(ganar), EV, mezcla, etc.),
//   - el botón "💡 Sugerencia",
//   - la pestaña "Solver".
// Útil para jugar con amigos sin filtrar la estrategia.
//
// Para reactivarlo, poné: export const SHOW_THINKING = true;
export const SHOW_THINKING = false;

// Interruptor de la política de ENVIDO.
//
//   true  -> la máquina usa la estrategia de equilibrio (CFR): casi inexplotable
//            y le gana mano a mano a la heurística, pero saca menos puntos contra
//            rivales débiles que farolean mal.
//   false -> vuelve a la heurística anterior (sobre-explota al rival débil:
//            más puntos contra mentirosos, pero es más explotable).
//
// Poné false para volver atrás sin perder nada: la heurística queda intacta.
// (Por ahora en false: jugamos con la heurística; el CFR queda en el repo,
// listo para reactivar cambiando esto a true.)
export const ENVIDO_CFR = false;
