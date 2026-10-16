import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Mensajes automáticos al cliente, editables desde el panel.
 *
 * El catálogo vive acá y no en la base: la base sólo guarda las variantes que
 * el operador escribió. Si no escribió ninguna —o si la base no responde— se
 * manda el texto por defecto, que es exactamente el que se mandaba antes de
 * que esto existiera. Un mensaje al usuario nunca depende de que una tabla
 * tenga datos.
 */
export const TEMPLATE_CATALOG = {
  PRIZE_PAID: {
    label: 'Premio pagado',
    help: 'Se manda con el comprobante de la transferencia. El monto va en una línea aparte.',
    default: 'Tu premio fue pagado. Adjuntamos el comprobante de la transferencia.',
  },
  PRIZE_REJECTED: {
    label: 'Premio rechazado',
    help: 'El motivo que escribe el operador se agrega abajo, no hace falta ponerlo acá.',
    default:
      'No pudimos aprobar tu pedido de cobro. Si tenés dudas o creés que es un error, tocá "Necesito ayuda" para hablar con un operador.',
  },
  CHIPS_LOADED: {
    label: 'Fichas cargadas',
    help: 'El aviso de que la carga entró. Es el mensaje que más se manda.',
    default: 'Fichas cargadas exitosamente!',
  },
  LOAD_FAILED: {
    label: 'Falló la carga',
    help: 'Cuando el bot no pudo cargar las fichas y lo va a revisar un operador.',
    default: 'Error al cargar fichas. Un operador va a revisar tu caso.',
  },
  PROOF_INVALID: {
    label: 'No se pudo validar el comprobante',
    help: 'La validación automática falló y queda para revisión manual.',
    default:
      'No pudimos validar el comprobante. Un operador va a revisar tu solicitud.',
  },
  PROOF_REUPLOAD: {
    label: 'Pedir el comprobante de nuevo',
    help: 'El pago está hecho pero el comprobante no sirvió. El motivo se agrega abajo.',
    default:
      'No pudimos validar tu comprobante. Subí de nuevo el comprobante de pago para continuar.',
  },
  REQUEST_REJECTED: {
    label: 'Carga rechazada',
    help: 'Rechazo de una solicitud de carga.',
    default: 'Solicitud rechazada.',
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATE_CATALOG;

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_CATALOG) as TemplateKey[];

/** Refresco de respaldo. La edición desde el panel invalida al instante; esto
 *  sólo cubre el caso de otra instancia del backend escribiendo. */
const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class MessageTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(MessageTemplatesService.name);

  /** key → variantes activas. Se lee en cada envío, así que vive en memoria. */
  private cache = new Map<string, string[]>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // Falla silenciosa a propósito: si la base no está lista al arrancar, los
    // mensajes salen con el texto por defecto y el próximo envío reintenta.
    await this.refresh().catch(() => {});
  }

  /**
   * El texto a mandar. Sincrónico y sin queries: si el cache está frío devuelve
   * el default y dispara la carga en segundo plano. Un mensaje al usuario no
   * puede quedar esperando una consulta.
   */
  pick(key: TemplateKey): string {
    if (Date.now() - this.loadedAt > CACHE_TTL_MS) {
      void this.refresh().catch(() => {});
    }
    const variants = this.cache.get(key);
    if (!variants?.length) return TEMPLATE_CATALOG[key].default;
    // Al azar: rotar en orden obligaría a guardar un puntero, que con más de
    // una instancia del backend se desincroniza y no aporta nada.
    return variants[Math.floor(Math.random() * variants.length)];
  }

  /** Arma el mensaje final: la plantilla arriba, los datos del sistema abajo. */
  compose(key: TemplateKey, ...lines: (string | null | undefined)[]): string {
    return [this.pick(key), ...lines.filter(Boolean)].join('\n\n');
  }

  async refresh(): Promise<void> {
    // Una sola carga en vuelo: al arrancar, todos los envíos concurrentes
    // pedirían la misma tabla a la vez.
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const rows = await this.prisma.messageTemplate.findMany({
          where: { enabled: true },
          select: { key: true, text: true },
        });
        const next = new Map<string, string[]>();
        for (const row of rows) {
          const text = (row.text || '').trim();
          if (!text) continue;
          next.set(row.key, [...(next.get(row.key) || []), text]);
        }
        this.cache = next;
        this.loadedAt = Date.now();
      } catch (err: any) {
        this.logger.warn(
          `No se pudieron cargar las plantillas, se usan los textos por defecto: ${err?.message || err}`,
        );
        // Se marca igual para no reintentar en cada mensaje si la base está caída.
        this.loadedAt = Date.now();
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  // ── CRUD para el panel ──────────────────────────────────────────────────

  async listAll() {
    const rows = await this.prisma.messageTemplate.findMany({
      orderBy: [{ key: 'asc' }, { createdAt: 'asc' }],
    });
    return TEMPLATE_KEYS.map((key) => ({
      key,
      label: TEMPLATE_CATALOG[key].label,
      help: TEMPLATE_CATALOG[key].help,
      fallback: TEMPLATE_CATALOG[key].default,
      variants: rows
        .filter((r) => r.key === key)
        .map((r) => ({
          id: r.id,
          text: r.text,
          enabled: r.enabled,
          updatedAt: r.updatedAt,
        })),
    }));
  }

  async save(input: {
    id?: string;
    key: string;
    text: string;
    enabled?: boolean;
    updatedBy?: string;
  }) {
    const key = input.key as TemplateKey;
    if (!TEMPLATE_KEYS.includes(key)) {
      throw new Error(`Mensaje desconocido: ${input.key}`);
    }
    const text = (input.text || '').trim();
    if (!text) throw new Error('El mensaje no puede quedar vacío');
    if (text.length > 1000) {
      throw new Error('El mensaje es demasiado largo (máximo 1000 caracteres)');
    }

    const data = {
      key,
      text,
      enabled: input.enabled !== false,
      updatedBy: input.updatedBy || null,
    };
    const row = input.id
      ? await this.prisma.messageTemplate.update({
          where: { id: input.id },
          data,
        })
      : await this.prisma.messageTemplate.create({ data });

    await this.forceRefresh();
    return row;
  }

  async remove(id: string) {
    await this.prisma.messageTemplate.delete({ where: { id } });
    await this.forceRefresh();
    return { success: true };
  }

  /** Tras editar, el cambio tiene que verse ya: el operador prueba y mira. */
  private async forceRefresh() {
    this.loadedAt = 0;
    await this.refresh();
  }
}
