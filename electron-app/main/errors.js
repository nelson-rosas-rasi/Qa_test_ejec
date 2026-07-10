/** Error de aplicación con un código estable que `ipc.js` traduce a un mensaje para el QA. */
function appError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

module.exports = { appError };
