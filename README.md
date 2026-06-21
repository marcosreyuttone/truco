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

## Fundamentos teóricos: dos enfoques

El truco 1v1 es un **juego de suma cero, de dos jugadores, con información
imperfecta y forma extensiva** (reparto oculto + apuestas secuenciales). Para
esa clase de juegos existe un **equilibrio de Nash** que, por definición, es
**inexplotable**: ningún rival puede sacarle ventaja esperada, juegue como
juegue. Hay dos caminos para acercarse a jugar bien. Acá los documentamos a
nivel "paper": el primero resuelve (aproximadamente) el equilibrio; el segundo
—el que está implementado— evalúa cada decisión localmente y acota la
explotabilidad sin resolver el equilibrio global.

---

### Paper 1 — Resolución por minimización de arrepentimiento (CFR): el camino a Nash

**Resumen.** El método estándar para aproximar el equilibrio de Nash de un
juego de información imperfecta es **CFR** (*Counterfactual Regret
Minimization*, Zinkevich et al., 2007): un algoritmo de **auto-juego
iterativo** cuya *estrategia promedio* converge a Nash. Lo que coloquialmente se
llama "el backprop que resuelve Nash" es la **propagación hacia atrás de los
arrepentimientos** por el árbol del juego; en su versión moderna (**Deep CFR**,
Brown et al., 2019) sí aparece *backpropagation* por descenso de gradiente, para
aproximar esos arrepentimientos con una red neuronal.

**Formalización.**
- *Forma extensiva*: historias `h`, un **conjunto de información** `I` agrupa las
  historias que un jugador no puede distinguir (porque no ve las cartas del
  rival), acciones `A(I)`, un jugador "azar" que reparte, y utilidades `u_i` en
  las hojas (los puntos ganados/perdidos).
- *Estrategia* `σ_i(I)`: una distribución sobre `A(I)` en cada info-set (esto es
  exactamente una **estrategia mixta**).
- *Explotabilidad*: la pérdida frente a la **mejor respuesta** del rival. En
  suma cero, **explotabilidad 0 ⇔ equilibrio de Nash**.

**El algoritmo.**
1. *Valor contrafactual* `v_i(σ, I)`: la utilidad esperada de llegar a `I`,
   pesada por la probabilidad **contrafactual** `π^σ_{-i}(I)` (cuánto contribuyen
   el azar y el rival a llegar ahí, asumiendo que `i` "quiso" llegar).
2. *Arrepentimiento* de no haber jugado `a` en `I`:
   `r(I,a) = v_i(σ_{I→a}, I) − v_i(σ, I)`.
3. *Arrepentimiento acumulado* `R^T(I,a) = Σ_t r_t(I,a)` y **regret matching**:
   la próxima estrategia es proporcional a la parte positiva,
   `σ^{T+1}(I,a) ∝ R^T_+(I,a)`.
4. **Teorema de convergencia**: la estrategia promedio `σ̄^T` es un
   `ε`-equilibrio con `ε = O(1/√T)`. El arrepentimiento global se **acota por la
   suma de los arrepentimientos locales** de cada info-set; por eso el cómputo se
   propaga recursivamente *hacia atrás* desde las hojas (la "retropropagación").

**Variantes relevantes.**
- **CFR+**: usa arrepentimientos truncados y promediado lineal; mucho más rápido
  en la práctica (resolvió el límite del Heads-Up Limit Poker).
- **MCCFR**: **muestrea trayectorias** en vez de recorrer todo el árbol en cada
  iteración (clave si el árbol es grande).
- **Deep CFR**: reemplaza la tabla de arrepentimientos por una **red neuronal**
  `R_θ(I,a)` entrenada por regresión sobre muestras → **acá sí hay
  backpropagation/gradiente**. Permite generalizar a juegos enormes sin tabla
  explícita.

**Qué requeriría hacerlo para el truco.**
1. **Modelo completo del árbol** con probabilidades contrafactuales: reparto
   (azar), envido encadenable, truco/retruco/vale cuatro, quiero/no quiero,
   orden de las 3 bazas y dependencia del **tanteador** (la falta envido y la
   presión del partido cambian la estrategia óptima según el marcador).
2. **Abstracción** para reducir el número de info-sets:
   - *de cartas*: agrupar manos por fuerza de juego y por puntos de envido
     (*bucketing*), porque manos parecidas se juegan igual;
   - *de acciones*: limitar la profundidad de recantos.
   Sin abstracción, los info-sets se multiplican por cada historia de apuestas y
   por cada estado del marcador.
3. **Cómputo offline**: correr CFR+/MCCFR por millones de iteraciones, o entrenar
   Deep CFR (auto-juego + red + gradiente). Esto produce una **tabla/red de
   estrategia** que después se consulta en milisegundos.
4. **Entrega**: la estrategia resultante puede pesar de MB a GB según la
   abstracción → **no entra cómoda en una página estática**; habría que abstraer
   agresivamente, comprimir, o servir un modelo desde un backend.
5. **Validación**: medir la **explotabilidad** con un *best-response* exacto para
   certificar qué tan cerca de Nash quedó.

**Veredicto.** Es el camino al juego *verdaderamente* inexplotable, pero es un
**proyecto offline considerable** (motor del árbol + solver + abstracción +
pipeline de entrenamiento + entrega del modelo), no algo que corra entero en el
navegador.

---

### Paper 2 — Monte Carlo, minimax exacto y mezcla balanceada (implementación actual)

**Resumen.** En vez de resolver el equilibrio global, **evaluamos cada decisión
localmente**: estimamos la probabilidad de ganar por **simulación Monte Carlo +
resolución exacta del final de cartas (minimax)**, calculamos el **envido de
forma exacta por enumeración**, y decidimos por **valor esperado** con umbrales
de indiferencia y **frecuencias de bluff balanceadas**. No es Nash, pero **acota
la explotabilidad** y es **liviano**: corre 100% en el navegador, sin backend ni
entrenamiento.

**Componentes.**
- **P(ganar la mano) por Monte Carlo.** Se **muestrean** las cartas ocultas del
  rival desde el mazo de cartas desconocidas, *condicionado a lo ya visto* (así
  se maneja la **información incompleta**: lo que el rival tiró o no tiró cambia
  el rango). Para cada muestra, el sub-juego de cartas restante es de
  **información perfecta**, así que se resuelve **exacto con minimax** (el árbol
  de ≤3 bazas es chico). El promedio de victorias es la probabilidad.
  Complejidad: `O(S · árbol_pequeño)` con `S` muestras.
- **Envido exacto.** Se **enumeran todas** las manos posibles del rival
  (`C(restantes, k)`) → distribución exacta de sus puntos y `P(ganar el envido)`.
  Esto **no es aproximado**: es el valor exacto.
- **Decisiones por EV (neutral al riesgo).** Querer una apuesta de valor `Vq`
  (no quiero paga `Vnq`) conviene si `p ≥ (Vq − Vnq) / (2·Vq)` → 25% truco, ~17%
  retruco, ~12,5% vale cuatro. Cantar/subir se decide combinando **valor** (manos
  fuertes) y **farol** (manos flojas).
- **Mezcla no explotable.** Cerca del umbral de indiferencia se **randomiza**
  (ahí ambas opciones valen casi lo mismo: no se pierde EV pero se deja de ser
  legible). El **farol se acota** por el *ratio de indiferencia* del rival, para
  que pagarnos o bajarse le dé lo mismo. El solver muestra estas frecuencias
  ("Quiero 70% · Retruco 30%").

**Por qué no es Nash (límites).**
- Es una evaluación **local y algo miope**: el minimax del final asume
  información perfecta *dentro de cada muestra*, lo que **sobreestima un poco**
  respecto del juego real con cartas ocultas.
- El muestreo del rival es **uniforme** sobre sus manos posibles; **no modela
  creencias bayesianas** actualizadas por la *estrategia* del rival (un rival de
  equilibrio sesga su rango con sus propias apuestas; eso lo captura CFR, no
  esto).
- Las frecuencias de bluff son **heurísticas calibradas**, no las exactas del
  equilibrio.
- Conclusión: **fuerte y difícil de explotar en la práctica**, y **exacto en el
  envido**, pero con una **brecha de explotabilidad no nula** respecto a Nash.

**Costo.** ~milisegundos por decisión, **sin entrenamiento offline, sin tabla,
sin backend**. Es lo que permite que todo viva en una página estática.

---

### Comparación y camino de migración

| | Paper 1 — CFR / Deep CFR | Paper 2 — Monte Carlo (actual) |
|---|---|---|
| Objetivo | Equilibrio de Nash (inexplotable) | Buena decisión local, baja explotabilidad |
| Garantía | `ε`-Nash, `ε → 0` | Sin garantía global; envido **exacto** |
| Dónde corre | Entrenamiento **offline** + tabla/modelo | **Todo en el navegador**, en vivo |
| Cómputo | Millones de iteraciones / GPU | Milisegundos por jugada |
| Entrega | MB–GB de estrategia | Unos KB de JS |
| Esfuerzo | Alto (árbol + abstracción + training) | Ya implementado |

**Para migrar al Paper 1** habría que: (1) construir el árbol del juego con
probabilidades contrafactuales y dependencia del marcador; (2) definir una
abstracción de cartas y de apuestas; (3) correr CFR+/MCCFR (o entrenar Deep CFR)
offline; (4) exportar la estrategia y consultarla desde la web; (5) medir
explotabilidad con *best response* para certificar cercanía a Nash. La
implementación actual (Paper 2) puede servir de **baseline** y banco de pruebas
para esa migración.

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
