import { BadRequestException, ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

/**
 * El ValidationPipe arma `message` como array. Ese array llegaba tal cual al
 * chat-app, que se lo pasa a Alert.alert(): Android hace getString("message")
 * sobre un array, tira UnexpectedNativeTypeException y cierra la app.
 */
describe('AllExceptionsFilter', () => {
  const runFilter = (exception: unknown) => {
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => ({ url: '/api/auth/client', method: 'POST' }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(exception, host);
    return json.mock.calls[0][0];
  };

  it('aplana el array de errores de validación a un string', () => {
    const body = runFilter(
      new BadRequestException([
        'El nombre de usuario debe tener al menos 3 caracteres',
        'Número de teléfono inválido',
      ]),
    );

    expect(typeof body.message).toBe('string');
    expect(body.message).toBe(
      'El nombre de usuario debe tener al menos 3 caracteres. Número de teléfono inválido',
    );
  });

  it('deja intacto el message que ya es string', () => {
    const body = runFilter(new BadRequestException('PHONE_REQUIRED'));
    expect(body.message).toBe('PHONE_REQUIRED');
  });
});
