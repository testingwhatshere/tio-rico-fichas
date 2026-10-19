import { debeReintentarSolo } from './reintento-automatico';

const base = {
  outcome: 'NOT_APPLIED',
  error: 'Login failed: Failed at verify_login (username="Cajero02", selector="li.user-toggle")',
  tocoAceptar: false,
  yaReintentado: false,
};

describe('debeReintentarSolo', () => {
  it('reintenta una falla de login antes de Aceptar (caso sabrinamac)', () => {
    expect(debeReintentarSolo(base)).toBe(true);
  });

  it.each([
    'Users page link not found in navigation',
    'La sesión del panel está cerrada y la extensión no tiene usuario/contraseña del panel configurados',
    'Tab load timed out after 15s',
    'Elemento no encontrado: .user-toggle',
  ])('reintenta fallas pasajeras: %s', (error) => {
    expect(debeReintentarSolo({ ...base, error })).toBe(true);
  });

  it('no reintenta si el backend vio que tocó Aceptar', () => {
    expect(debeReintentarSolo({ ...base, tocoAceptar: true })).toBe(false);
  });

  it('no reintenta dos veces', () => {
    expect(debeReintentarSolo({ ...base, yaReintentado: true })).toBe(false);
  });

  it.each([undefined, 'UNCERTAIN', 'APPLIED'])(
    'no reintenta con outcome %s',
    (outcome) => {
      expect(debeReintentarSolo({ ...base, outcome })).toBe(false);
    },
  );

  it.each([
    'Fichas insuficientes en el panel: disponible $5.000, necesario $10.000',
    'Usuario "pepe" no encontrado en este panel — backend reintentará en otros paneles',
    'No se cargó: el monto 10.5 no es válido (tiene que ser un número entero)',
    'No se cargó: el panel respondió 422',
    'No se cargó',
    'El guardia bloqueó un envío con otro monto',
    'el panel no la aplicó (no figura en el historial)',
    'La carga fue cancelada (tiempo agotado): NO se toca Aceptar',
    'Aceptar ya se tocó para esta carga: NO se toca de nuevo',
    'Operation failed: No success/error response detected after clicking Aceptar',
    'Carga duplicada evitada',
  ])('no reintenta errores definitivos o posteriores a Aceptar: %s', (error) => {
    expect(debeReintentarSolo({ ...base, error })).toBe(false);
  });
});
