/**
 * Regla única del nombre de usuario del panel de juego.
 *
 * Existía por duplicado en cada capa y las copias divergieron: el login exigía
 * letra inicial mientras el import de CSV aceptaba números, así que 122 clientes
 * quedaron cargados en la base sin poder entrar nunca (2026-08-28). Cualquier
 * validación nueva de username tiene que importar esto, no re-escribir el regex.
 *
 * Sin espacios y sin signos: el nombre se tipea tal cual en el panel externo.
 */
export const PANEL_USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

export const PANEL_USERNAME_MESSAGE =
  'El nombre de usuario solo puede tener letras, números y guiones bajos (sin espacios ni signos)';

export const PANEL_USERNAME_MIN_LENGTH = 3;
export const PANEL_USERNAME_MAX_LENGTH = 30;

/** `true` si el nombre respeta charset y longitud. No normaliza: validá el valor ya trimmeado. */
export function isValidPanelUsername(username: string): boolean {
  return (
    username.length >= PANEL_USERNAME_MIN_LENGTH &&
    username.length <= PANEL_USERNAME_MAX_LENGTH &&
    PANEL_USERNAME_REGEX.test(username)
  );
}
