/**
 * Traduce los errores del bot y del validador a algo que un operador pueda usar.
 *
 * Los mensajes crudos vienen del automatismo y describen el mecanismo, no el
 * problema: "Operation failed: No success/error response detected after clicking
 * Aceptar" no le dice a nadie si las fichas se cargaron o no. Lo que el operador
 * necesita saber es qué pasó y qué puede hacer.
 *
 * Si un error no matchea, se devuelve tal cual: es preferible mostrar el texto
 * técnico que inventar una explicación.
 */
const RULES: { match: RegExp; text: string }[] = [
  {
    match: /no success\/error response detected|no sweetalert response/i,
    text: 'El panel no confirmó la carga — puede haberse cargado igual, verificá antes de reintentar',
  },
  {
    match: /fichas insuficientes/i,
    text: 'El panel no tiene fichas suficientes para esta carga',
  },
  {
    match: /session validation failed|script injection failed|could not load/i,
    text: 'Se perdió la sesión en el panel de juego — hay que volver a iniciarla',
  },
  {
    match: /circuit breaker/i,
    text: 'La extensión se pausó sola tras varios fallos seguidos',
  },
  {
    match: /credit load failed/i,
    text: 'La carga de fichas no se completó',
  },
  {
    match: /password change failed/i,
    text: 'No se pudo cambiar la contraseña del usuario',
  },
  {
    match: /navigate_to_users_page/i,
    text: 'El bot no pudo llegar a la lista de usuarios del panel',
  },
  // ── Las específicas van ANTES de la regla genérica de timeout ──────────────
  // `RULES.find` corta en la primera que matchea, y /timed out/ se come todo:
  // un discovery vencido se mostraba como "el validador no respondió", que es
  // falso y manda al operador a revisar el lugar equivocado.
  {
    match: /discovery (timed out|failed)|panel\(s\) (checked|unchecked)/i,
    text: 'No se pudo determinar en qué panel está este usuario — asignáselo a mano y reintentá',
  },
  {
    match: /job timed out|no progress received/i,
    text: 'El bot se colgó a mitad de la carga — fijate en el panel si se cargó antes de reintentar',
  },
  {
    match: /user_not_found|usuario no encontrado|no se encontró el usuario/i,
    text: 'Ese nombre no existe en el panel — revisá cómo está escrito',
  },
  {
    match: /username.?taken|ya existe|already exists/i,
    text: 'Ese nombre ya está usado en el panel — probá con otro',
  },
  {
    match: /is busy|panel ocupado/i,
    text: 'El panel estaba ocupado con otra carga — reintentá en un minuto',
  },
  {
    match: /timed out|timeout/i,
    text: 'El validador no respondió a tiempo — el comprobante quedó sin revisar',
  },
  {
    match: /no validator connected|validator disconnected|servicio de validación no está disponible/i,
    text: 'El validador automático estaba caído — hay que revisar el comprobante a mano',
  },
  {
    match: /baja confianza/i,
    text: 'La IA no pudo leer el comprobante con seguridad',
  },
  {
    match: /no se pudo asignar un panel/i,
    text: 'No se encontró a este usuario en ningún panel',
  },
  {
    match: /no bots connected/i,
    text: 'No hay ningún bot conectado',
  },
];

export function humanizeError(raw: string | null | undefined): string {
  if (!raw) return 'Sin detalle';
  const found = RULES.find((r) => r.match.test(raw));
  return found ? found.text : raw;
}
