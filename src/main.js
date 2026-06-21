// Punto de entrada: pestañas + inicialización de cada modo.
import { initPlay } from './play.js';
import { initSolver } from './solver-ui.js';

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
initSolver();
