import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientAuthDto } from './client-auth.dto';

/**
 * El regex del username tenía `^[a-zA-Z]` y dejaba afuera a los 122 clientes
 * precargados cuyo nombre de panel arranca con número ("15sebas15"): el 400 del
 * ValidationPipe llegaba al chat-app como array y le cerraba la app.
 */
describe('ClientAuthDto', () => {
  const validateUsername = async (username: string) => {
    const dto = plainToInstance(ClientAuthDto, {
      username,
      phone: '1155667788',
    });
    const errors = await validate(dto);
    return errors.filter((e) => e.property === 'username');
  };

  it.each(['15sebas15', '15vicente15', '3312diego', '234cintia8', '_juan'])(
    'acepta "%s" (arranca con número o guión bajo)',
    async (username) => {
      expect(await validateUsername(username)).toHaveLength(0);
    },
  );

  it.each(['juan_perez', 'sebas15'])('sigue aceptando "%s"', async (username) => {
    expect(await validateUsername(username)).toHaveLength(0);
  });

  // Sin espacios ni signos: el nombre se tipea tal cual en el panel externo.
  it.each([
    'ju',
    'juan perez',
    ' juan',
    'juan ',
    'juan\tperez',
    'juan-perez',
    'juan.perez',
    'juan@perez',
    'juan+perez',
    "juan'perez",
    'juan;drop',
    'ñandu',
    'josé',
    'juan/perez',
    'juan\\perez',
    '<script>',
    'juan%20perez',
    'juan😀',
  ])('rechaza "%s"', async (username) => {
    expect((await validateUsername(username)).length).toBeGreaterThan(0);
  });
});
