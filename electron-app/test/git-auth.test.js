const test = require('node:test');
const assert = require('node:assert/strict');
const { createGitAuth } = require('../main/github/git-auth');

test('el token viaja en el entorno y nunca en los argumentos', () => {
  const auth = createGitAuth(() => 'gho_secreto123');
  assert.equal(auth.args().join(' ').includes('gho_secreto123'), false);
  assert.equal(auth.env().QA_GH_TOKEN, 'gho_secreto123');
});

test('el ayudante sólo se ofrece a github.com', () => {
  const auth = createGitAuth(() => 'x');
  assert.ok(auth.args().some((arg) => arg.startsWith('credential.https://github.com.helper=')));
  assert.ok(auth.args().every((arg) => !arg.startsWith('credential.helper=')));
});

test('limpia los ayudantes heredados antes de poner el suyo', () => {
  const args = createGitAuth(() => 'x').args();
  assert.equal(args[1], 'credential.https://github.com.helper=');
  assert.ok(args[3].startsWith('credential.https://github.com.helper=!f()'));
});

test('git nunca pregunta por teclado, haya cuenta o no', () => {
  assert.equal(createGitAuth(() => 'x').env().GIT_TERMINAL_PROMPT, '0');
  assert.equal(createGitAuth(() => null).env().GIT_TERMINAL_PROMPT, '0');
});

test('sin cuenta conectada no inyecta argumentos ni token', () => {
  const auth = createGitAuth(() => null);
  assert.deepEqual(auth.args(), []);
  assert.equal(auth.env().QA_GH_TOKEN, undefined);
});

test('lee el token en cada llamada, no al construirse', () => {
  let token = null;
  const auth = createGitAuth(() => token);
  assert.deepEqual(auth.args(), []);
  token = 'llegó-después';
  assert.equal(auth.env().QA_GH_TOKEN, 'llegó-después');
});

test('el token llega a git a través del ayudante', () => {
  const { spawnSync } = require('node:child_process');
  const testToken = 'gho_prueba_123456';
  const auth = createGitAuth(() => testToken);

  const result = spawnSync('git', [
    ...auth.args(),
    'credential',
    'fill'
  ], {
    input: 'protocol=https\nhost=github.com\n\n',
    env: { ...process.env, ...auth.env() },
    encoding: 'utf-8'
  });

  assert.ok(result.stdout.includes('username=x-access-token'));
  assert.ok(result.stdout.includes(`password=${testToken}`));
});
