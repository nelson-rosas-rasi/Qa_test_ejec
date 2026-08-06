const LABELS = {
  git: 'Herramienta para traer los proyectos de prueba',
  node: 'Motor que instala las dependencias de cada proyecto',
  browsers: 'Navegadores con los que se ejecutan las pruebas',
  runqa: 'RunQA',
};

/**
 * RunQA no se salta nunca: aunque el equipo ya tenga todo lo demás, el sentido
 * del setup es terminar con la app instalada.
 */
function planSteps(estado) {
  const hecho = {
    git: Boolean(estado.git?.ok),
    node: Boolean(estado.node?.ok && estado.npm?.ok),
    browsers: Boolean(estado.browsers?.ok),
    runqa: false,
  };
  return ['git', 'node', 'browsers', 'runqa'].map((id) => ({
    id,
    label: LABELS[id],
    status: hecho[id] ? 'done' : 'pending',
  }));
}

module.exports = { planSteps, LABELS };
