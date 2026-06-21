# 🃏 Truco Solver

Juego y *solver* de **Truco argentino 1v1 (mano a mano)** a 30 puntos, 100% en el
navegador (sin backend), pensado para correr gratis en **GitHub Pages**.

La máquina no juega con reglas fijas: estima **probabilidades** y decide por
**valor esperado en puntos** (neutral al riesgo), usando **información
incompleta** (lo que el rival tiró o dejó de tirar) y algo de **bluff** para no
ser explotable (estrategias mixtas).

## Qué incluye

- **Jugar**: partida contra la máquina. La máquina canta/recanta truco y envido,
  acepta o se baja, y **explica por qué** cada jugada. Botón **💡 Sugerencia**
  para que te diga a vos la jugada correcta en tu turno.
- **Solver**: cargás el tanteador, quién es mano, tus 3 cartas y qué tiró cada
  jugador hasta ahora, y te recomienda la jugada con su razonamiento, la
  probabilidad de ganar la mano y el valor esperado de cada opción.

## Cómo funciona la IA

- **Truco** → lo que importa es *P(ganar la mano)*. Se estima por **Monte Carlo**:
  se muestrean las cartas ocultas del rival (consistentes con lo ya visto) y se
  resuelve el final de cartas de forma **exacta con minimax**. El promedio de
  victorias es la probabilidad.
- **Envido** → se **enumeran todas** las manos posibles del rival para obtener la
  distribución exacta de sus puntos y la probabilidad de ganar el envido.
- **Decisiones** → por valor esperado:
  - Querer una apuesta de valor `Vq` (no quiero paga `Vnq`) conviene si
    `p ≥ (Vq − Vnq) / (2·Vq)`. Para el truco eso da 25%, retruco ~17%, vale
    cuatro ~12,5% (cuanto más hay en juego, más liviano se quiere).
  - Cantar/subir conviene cuando el EV de cantar supera al de no cantar,
    modelando que el rival se baja cuando es débil.
  - Con manos parejas o como farol ocasional se randomiza (estrategia mixta).

## Reglas implementadas

- Mazo español de 40 cartas y jerarquía completa del truco
  (1 espada > 1 basto > 7 espada > 7 oro > 3 > 2 > anchos falsos > 12 > 11 > 10 >
  7 falsos > 6 > 5 > 4).
- Envido / Real Envido / Falta Envido (encadenables) y el "envido es primero".
- Truco / Retruco / Vale Cuatro, quiero / no quiero, irse al mazo.
- Resolución de la mano a 2 de 3 bazas con todas las reglas de parda (incluido
  "gana quien ganó la primera" y "todas pardas gana el mano").
- Partida a 30 puntos.

**Variante:** 1 contra 1, **sin flor** (la más limpia para el solver). Si querés
flor, más jugadores o partida a 15, se puede agregar.

## Correr local

Es un sitio estático: abrí `index.html` con un servidor (los ES modules no
cargan con `file://`):

```bash
python3 -m http.server 8000   # luego abrí http://localhost:8000
```

Tests del motor y la IA:

```bash
node test/run.js
```

## Publicar en GitHub Pages

El repo trae un workflow (`.github/workflows/deploy.yml`) que corre los tests y
publica el sitio. Para activarlo, una sola vez:

1. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Pusheá a la rama `claude/truco-game-solver-cz0la2` (o a `main`).

La URL queda como `https://<usuario>.github.io/truco/`.
