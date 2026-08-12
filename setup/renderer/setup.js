const MARCAS = { pending: '○', running: '▸', done: '✓', error: '✕' };

const lista = document.getElementById('pasos');
const aviso = document.getElementById('error');
const empezar = document.getElementById('empezar');

function pintar({ steps, error }) {
  lista.innerHTML = steps.map((paso) => `
    <li data-status="${paso.status}">
      <span class="marca">${MARCAS[paso.status]}</span>
      <span class="etiqueta">${paso.label}</span>
      ${paso.status === 'running' ? `<span class="barra"><span style="width:${paso.percent || 0}%"></span></span>` : ''}
      ${paso.status === 'error' ? `<button class="secundario" data-retry="${paso.id}">Reintentar</button>` : ''}
    </li>`).join('');

  aviso.hidden = !error;
  aviso.textContent = error || '';
  empezar.disabled = steps.some((paso) => paso.status === 'running');
  empezar.textContent = steps.every((paso) => paso.status === 'done') ? 'Listo' : 'Empezar';

  for (const boton of lista.querySelectorAll('[data-retry]')) {
    boton.onclick = () => window.setup.retry(boton.dataset.retry);
  }
}

window.setup.onState(pintar);
empezar.onclick = () => window.setup.start();
document.getElementById('registro').onclick = () => window.setup.openLog();
window.setup.refresh();
