const MARCAS = { pending: '○', running: '▸', done: '✓', error: '✕' };

const lista = document.getElementById('pasos');
const aviso = document.getElementById('error');
const empezar = document.getElementById('empezar');
const manual = document.getElementById('manual');
const verificar = document.getElementById('verificar');
let ultimoEstado = [];

function pintar({ steps, error }) {
  ultimoEstado = steps;
  lista.innerHTML = steps.map((paso) => `
    <li data-status="${paso.status}">
      <span class="marca">${MARCAS[paso.status]}</span>
      <span class="etiqueta">${paso.label}</span>
      ${paso.status === 'running' ? `<span class="barra"><span style="width:${paso.percent || 0}%"></span></span>` : ''}
      ${paso.status === 'error' ? `<button class="secundario" data-retry="${paso.id}">Reintentar</button>` : ''}
    </li>`).join('');

  aviso.hidden = !error;
  // Cuando un paso falla, «Reintentar» corre el mismo comando y falla igual: lo
  // que saca al QA del pozo es el modo manual. Por eso el aviso lo nombra y el
  // botón cambia de peso, en vez de aparecer uno nuevo que nadie vio antes.
  aviso.textContent = error ? `${error} También podés instalarlo a mano.` : '';
  const hayError = steps.some((paso) => paso.status === 'error');
  manual.classList.toggle('destacado', hayError);
  verificar.hidden = !hayError;
  empezar.disabled = steps.some((paso) => paso.status === 'running');
  empezar.textContent = steps.every((paso) => paso.status === 'done') ? 'Listo' : 'Empezar';

  for (const boton of lista.querySelectorAll('[data-retry]')) {
    boton.onclick = () => window.setup.retry(boton.dataset.retry);
  }
}

window.setup.onState(pintar);
empezar.onclick = () => window.setup.start();
manual.onclick = () => window.setup.manual(ultimoEstado);
verificar.onclick = () => window.setup.refresh();
document.getElementById('registro').onclick = () => window.setup.openLog();
window.setup.refresh();
