// renderer/constants.js — Pure constants for the operator panel

export const MAX_PENDING_CHAT_MESSAGES = 100;
export const MAX_RECENT_MESSAGE_IDS = 200;
export const RECENTLY_ACTIONED_TTL = 30000; // 30 seconds
export const MAX_QUICK_REPLIES = 20;

export const DEFAULT_QUICK_REPLIES = [
  { id: 'default_1', icon: '\u{1F44B}', label: 'Saludo', text: 'Hola! En que puedo ayudarte?', order: 0 },
  { id: 'default_2', icon: '\u{23F3}', label: 'En proceso', text: 'Tu solicitud esta siendo procesada. Te avisaremos cuando este lista.', order: 1 },
  { id: 'default_3', icon: '\u{2705}', label: 'Completado', text: 'Los creditos han sido cargados correctamente. Gracias por tu preferencia!', order: 2 },
  { id: 'default_4', icon: '\u{1F4C4}', label: 'Reenviar comprobante', text: 'Necesitamos que vuelvas a enviar el comprobante de pago, el anterior no es legible. Asegurate de que se vea el monto, la fecha y el numero de operacion.', order: 3 },
  { id: 'default_5', icon: '\u{1F4B0}', label: 'Monto incorrecto', text: 'El monto del comprobante no coincide con el solicitado. Por favor verifica y envia el comprobante correcto.', order: 4 },
  { id: 'default_6', icon: '\u{1F64F}', label: 'Despedida', text: 'Gracias por contactarnos. Que tengas un excelente dia!', order: 5 },
  { id: 'default_7', icon: '\u{1F6E0}', label: 'Mantenimiento', text: 'La plataforma de juegos esta en mantenimiento temporario. No te preocupes, podes seguir cargando fichas y van a estar disponibles cuando vuelva a funcionar.', order: 6 },
  { id: 'default_8', icon: '\u{23F0}', label: 'Demora', text: 'Disculpa la demora, estamos procesando tu solicitud. En unos minutos va a estar lista.', order: 7 },
  { id: 'default_9', icon: '\u{1F4B3}', label: 'Datos de pago', text: 'Para cobrar tu premio necesitamos tus datos bancarios: nombre del titular, CBU o alias. Podes enviarlos por este chat.', order: 8 },
  { id: 'default_10', icon: '\u{26A0}', label: 'Comprobante vencido', text: 'El comprobante que enviaste tiene una fecha que no es de hoy. Necesitamos un comprobante del dia de hoy para poder procesar la carga.', order: 9 },
  { id: 'default_11', icon: '\u{1F4F8}', label: 'Mejor foto', text: 'La imagen del comprobante esta borrosa o cortada. Podes sacar otra foto mas clara? Necesitamos ver el monto y la fecha completos.', order: 10 },
  { id: 'default_12', icon: '\u{1F3B0}', label: 'Premio enviado', text: 'Tu premio fue transferido! En unos minutos deberia verse reflejado en tu cuenta bancaria. Gracias por jugar en Tio Rico!', order: 11 },
];

export const VIEW_TITLES = {
  dashboard: 'Dashboard',
  failures: 'Fallos Pendientes',
  jobs: 'Trabajos',
  requests: 'Solicitudes',
  chats: 'Chats de Soporte',
  activity: 'Registro de Actividad',
  wallets: 'Gesti\u00f3n de Billeteras',
  prizes: 'Premios',
  payments: 'Pagos Salientes',
  users: 'Usuarios',
  'preload-users': 'Usuarios Pre-cargados',
  panels: 'Paneles',
  extensions: 'Extensiones',
  settings: 'Configuraci\u00f3n'
};

export const REQUEST_STATUS_CONFIG = {
  PENDING:           { label: 'Pendiente',          class: 'queued'     },
  PENDING_PROOF:     { label: 'Esperando Prueba',   class: 'queued'     },
  VALIDATING:                { label: 'Validando',           class: 'processing' },
  PENDING_MP_VERIFICATION:   { label: 'Verificando Pago',    class: 'processing' },
  VALIDATION_FAILED:         { label: 'Validacion Fallida',  class: 'failed'     },
  APPROVED:                  { label: 'Aprobado',            class: 'completed'  },
  PROCESSING:        { label: 'Procesando',         class: 'processing' },
  COMPLETED:         { label: 'Completado',         class: 'completed'  },
  FAILED:            { label: 'Fallido',            class: 'failed'     },
  REJECTED:          { label: 'Rechazado',          class: 'failed'     },
  CANCELLED:         { label: 'Cancelado',          class: 'failed'     },
};

// Duck mascot for empty states (uses the correct logo image)
export const DUCK_SVG = `<img src="../assets/duck-logo.png" width="48" height="48" alt="Tio Rico" style="border-radius: 12px;" class="empty-state-duck">`;

export const ACTION_ICONS = {
  CONNECTED: '\u{1F7E2}',
  DISCONNECTED: '\u{1F534}',
  FAILURE_APPROVED: '\u{2705}',
  FAILURE_REJECTED: '\u{274C}',
  JOB_COMPLETED: '\u{2705}',
  JOB_FAILED: '\u{274C}',
  JOB_RETRIED: '\u{1F504}',
  MESSAGE_SENT: '\u{1F4AC}',
  CHAT_CLOSED: '\u{1F4ED}',
  KILL_SWITCH_ACTIVATED: '\u{1F6D1}',
  KILL_SWITCH_DEACTIVATED: '\u{25B6}\u{FE0F}',
  VALIDATION_FAILED: '\u{26A0}\u{FE0F}',
  RECONNECT_REQUESTED: '\u{1F504}'
};

export const FLAG_LABELS = {
  'RECIPIENT_MISMATCH': 'Destinatario no coincide',
  'RECIPIENT_ACCOUNT_MISMATCH': 'Cuenta destino no coincide',
  'DUPLICATE_TRANSACTION_ID': 'Nro de operacion duplicado',
  'CROSS_USER_DUPLICATE': 'Duplicado de otro usuario',
  'CROSS_USER_SENDER': 'Remitente de otro usuario',
  'HIGH_FAILURE_RATE': 'Muchos intentos fallidos',
  'VERY_HIGH_FAILURE_RATE': 'Alta tasa de fallos',
  'MULTIPLE_SENDERS': 'Multiples remitentes',
  'LIKELY_EDITED': 'Posiblemente editado',
  'INVALID_FORMAT': 'Formato invalido',
  'STATUS_NOT_APPROVED': 'Estado no aprobado',
  'AMOUNT_MISMATCH': 'Monto no coincide',
  'OLD_DATE': 'Fecha antigua',
  'FUTURE_DATE': 'Fecha futura',
};

export const WALLET_TYPE_LABELS = {
  'MERCADOPAGO': 'MercadoPago',
  'CBU': 'CBU',
  'CVU': 'CVU',
  'RIPIO': 'Ripio',
  'FIWIND': 'Fiwind',
  'PREX': 'Prex',
};

export const OUTBOUND_PAYMENT_STATUS_CONFIG = {
  PENDING:    { label: 'Pendiente',   class: 'queued',     icon: '\u{23F3}' },
  CONFIRMED:  { label: 'Confirmado',  class: 'processing', icon: '\u{2705}' },
  QUEUED:     { label: 'En cola',     class: 'queued',     icon: '\u{1F4CB}' },
  PROCESSING: { label: 'Pagando...',  class: 'processing', icon: '\u{1F4B8}' },
  COMPLETED:  { label: 'Pagado',      class: 'completed',  icon: '\u{2705}' },
  FAILED:     { label: 'Fallido',     class: 'failed',     icon: '\u{274C}' },
  CANCELLED:  { label: 'Cancelado',   class: 'failed',     icon: '\u{1F6AB}' },
};

export const EXTENSION_TYPE_LABELS = {
  automation: '\u{1F3AE} Automatizacion',
  'mp-verifier': '\u{1F6E1}\u{FE0F} Verificador MP',
  'fiwind-verifier': '\u{1F6E1}\u{FE0F} Verificador Fiwind',
  'ripio-verifier': '\u{1F6E1}\u{FE0F} Verificador Ripio',
  'prex-verifier': '\u{1F6E1}\u{FE0F} Verificador Prex',
  'mp-payment': '\u{1F4B0} Pago MP',
  'fiwind-payment': '\u{1F4B0} Pago Fiwind',
  'ripio-payment': '\u{1F4B0} Pago Ripio',
  'prex-payment': '\u{1F4B0} Pago Prex',
};

export const EXTENSION_STATUS_CONFIG = {
  online: { label: 'Online', class: 'status-online', dot: '\u{1F7E2}' },
  busy: { label: 'Procesando', class: 'status-busy', dot: '\u{1F7E1}' },
  error: { label: 'Error', class: 'status-error', dot: '\u{1F534}' },
  offline: { label: 'Offline', class: 'status-offline', dot: '\u{26AA}' },
  degraded: { label: 'Degradado', class: 'status-degraded', dot: '\u{1F7E0}' },
};

export const JOB_STATUS_CONFIG = {
  PROCESSING: { icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', class: 'processing' },
  COMPLETED: { icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', class: 'completed' },
  FAILED: { icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z', class: 'failed' },
  QUEUED: { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', class: 'queued' }
};
