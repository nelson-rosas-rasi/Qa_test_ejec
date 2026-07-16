/**
 * Traduce el token de la cuenta en la forma de invocar `git` autenticado.
 *
 * El token va SIEMPRE en el entorno y NUNCA en los argumentos: la línea de
 * comandos de un proceso es visible desde el administrador de tareas y desde
 * `ps`; el entorno no lo es para otros usuarios.
 */
const CREDENTIAL_KEY = 'credential.https://github.com.helper';
const TOKEN_ENV = 'QA_GH_TOKEN';
const HELPER = `!f() { test "$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "$${TOKEN_ENV}"; }; f`;

/** @param getToken función (no el token) para que una desconexión se note en la siguiente invocación. */
function createGitAuth(getToken) {
  return {
    args() {
      if (!getToken()) return [];
      // La clave vacía limpia los ayudantes heredados (p. ej. Git Credential
      // Manager), que si no abrirían su propia ventana.
      return ['-c', `${CREDENTIAL_KEY}=`, '-c', `${CREDENTIAL_KEY}=${HELPER}`];
    },
    /**
     * Devuelve un overlay de variables de entorno para ser extendidas sobre
     * process.env, no un ambiente completo. Pasar directamente a execFile
     * dejaría sin PATH al proceso.
     */
    env() {
      const token = getToken();
      // Sin GIT_TERMINAL_PROMPT=0, un fallo de credencial deja a git esperando
      // una respuesta por teclado que nunca llega: execFile no le da terminal.
      const base = { GIT_TERMINAL_PROMPT: '0' };
      return token ? { ...base, [TOKEN_ENV]: token } : base;
    },
  };
}

module.exports = { createGitAuth };
