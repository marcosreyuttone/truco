// Punto de entrada: pestañas + inicialización de cada modo.
import { initPlay } from './play.js';
import { initSolver } from './solver-ui.js';
import { SHOW_THINKING } from './config.js';

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      document.getElementById('view-' + tab.dataset.view).classList.add('active');
    });
  });
}

setupTabs();
initPlay();

if (SHOW_THINKING) {
  initSolver();
} else {
  // Ocultar la pestaña Solver (también revela la estrategia).
  const solverTab = document.querySelector('.tab[data-view="solver"]');
  if (solverTab) solverTab.style.display = 'none';
}
