#!/usr/bin/env node
'use strict';

const path = require('path');

const PLACEHOLDER_OWNER = 'CAMBIAME-usuario-u-org';
const PLACEHOLDER_REPO = 'runqa-releases';

function findPlaceholderFields(publish) {
  const problems = [];
  if (!publish || publish.owner === PLACEHOLDER_OWNER) problems.push('owner');
  if (!publish || publish.repo === PLACEHOLDER_REPO) problems.push('repo');
  return problems;
}

function main() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const publish = pkg.build && pkg.build.publish;
  const problems = findPlaceholderFields(publish);

  if (problems.length > 0) {
    console.error(
      `[release] falta configurar ${problems.join(' y ')} en package.json -> build.publish ` +
      'antes de publicar (hoy tiene el valor de ejemplo, no un repo real de GitHub).'
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findPlaceholderFields, PLACEHOLDER_OWNER, PLACEHOLDER_REPO };
