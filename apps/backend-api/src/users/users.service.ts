import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ModuleRef } from '@nestjs/core';
import { RequestStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { PushService } from '../notifications/push.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, EntityType } from '../audit/dto';
import { canonicalArPhone } from '../common/utils/phone.util';
import {
  PANEL_USERNAME_REGEX,
  PANEL_USERNAME_MESSAGE,
  PANEL_USERNAME_MIN_LENGTH,
  PANEL_USERNAME_MAX_LENGTH,
} from '../common/validators/username';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly auditService: AuditService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Returns the panel-game credentials of a user so operators can help during
   * support (recover lost passwords, verify identity). Every read is audited.
   * If panelPassword is null, the user has never changed it via the platform —
   * the UI must display the system default ('123casino') with a "may have changed"
   * disclaimer. We don't fabricate '123casino' here on purpose.
   */
  async getPanelInfoForOperator(
    targetUserId: string,
    operatorId: string,
  ): Promise<{
    userId: string;
    savedTargetUsername: string | null;
    panelPassword: string | null;
    panelPasswordUpdatedAt: Date | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        savedTargetUsername: true,
        panelPassword: true,
        panelPasswordUpdatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Audit log — fire and forget; do not block the response on logging failure.
    this.auditService
      .log({
        operatorId,
        action: AuditAction.USER_PANEL_INFO_VIEWED,
        entityType: EntityType.USER,
        entityId: targetUserId,
        metadata: { hasPanelPassword: user.panelPassword != null },
      })
      .catch((err: any) =>
        this.logger.warn(
          `Failed to audit USER_PANEL_INFO_VIEWED: ${err.message}`,
        ),
      );

    return {
      userId: user.id,
      savedTargetUsername: user.savedTargetUsername,
      panelPassword: user.panelPassword,
      panelPasswordUpdatedAt: user.panelPasswordUpdatedAt,
    };
  }

  /**
   * Quién usa la app, para cruzar contra el ranking de cargas del panel (lo
   * consume la extensión Recolectora). Solo lectura y con campos mínimos: se
   * baja entero cada vez que alguien genera el reporte.
   *
   * - `usuarios`: clientes de la base, con el username del panel que recuerdan
   *   y si vinieron precargados por CSV (están en la base sin haber usado la app).
   * - `cargas`: cargas COMPLETADAS por la app, agrupadas por username del panel.
   */
  async getAppUsage() {
    const [usuarios, cargas] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: UserRole.CLIENT },
        select: { username: true, savedTargetUsername: true, isPreloaded: true },
      }),
      this.prisma.request.groupBy({
        by: ['targetUsername'],
        where: { status: RequestStatus.COMPLETED },
        _count: { _all: true },
        _sum: { amount: true },
        _max: { createdAt: true },
      }),
    ]);

    return {
      generadoEn: new Date().toISOString(),
      usuarios: usuarios.map((u) => ({
        u: u.username,
        p: u.savedTargetUsername,
        pre: u.isPreloaded,
      })),
      cargas: cargas.map((c) => ({
        t: c.targetUsername,
        n: c._count._all,
        monto: Number(c._sum.amount ?? 0),
        ultima: c._max.createdAt,
      })),
    };
  }

  async findAll(page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updatePushToken(userId: string, token: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pushToken: token },
    });
    this.logger.log(`Push token updated for user ${userId}`);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Manually assign a gaming-panel to a user (operator action).
   *
   * Used when automatic discovery couldn't resolve the user's panel (e.g. the
   * panel's bot flapped during the search and never answered, leaving the load
   * stuck). Setting the panel here means future requests skip discovery entirely.
   *
   * If the user has a hung FAILED request (discovery failure with no job), it is
   * re-queued straight to the assigned panel — same fast-path an operator "retry"
   * would take now that the user has a panelId.
   */
  async assignPanel(userId: string, panelId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, panelId: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const panel = await this.prisma.panel.findUnique({
      where: { id: panelId },
      select: { id: true, name: true, isActive: true },
    });
    if (!panel) {
      throw new NotFoundException('Panel no encontrado');
    }
    if (!panel.isActive) {
      throw new BadRequestException(
        `El panel "${panel.name}" está inactivo. Elegí un panel activo.`,
      );
    }

    const previousPanelId = user.panelId;
    await this.prisma.user.update({
      where: { id: userId },
      data: { panelId },
    });

    this.auditService
      .log({
        action: AuditAction.USER_PANEL_ASSIGNED,
        entityType: EntityType.USER,
        entityId: userId,
        metadata: {
          previousPanelId,
          newPanelId: panelId,
          panelName: panel.name,
          reason: 'manual_panel_assignment',
        },
      })
      .catch((err: any) =>
        this.logger.warn(`Failed to audit panel assignment: ${err?.message}`),
      );

    this.logger.log(
      `User ${user.username ?? userId} assigned to panel ${panel.name} (${panelId})` +
        (previousPanelId ? ` (was ${previousPanelId})` : ''),
    );

    // Re-queue the most recent hung FAILED request (if any) now that we know the panel.
    let requeuedRequestId: string | null = null;
    const stuck = await this.prisma.request.findFirst({
      where: { userId, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (stuck) {
      try {
        const { DiscoveryService } = require('../discovery/discovery.service');
        const discoveryService = this.moduleRef.get(DiscoveryService, {
          strict: false,
        });
        await discoveryService.retryDiscoveryForRequest(stuck.id);
        requeuedRequestId = stuck.id;
        this.logger.log(
          `Re-queued hung request ${stuck.id} for user ${userId} on panel ${panelId}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Panel assigned but failed to re-queue request ${stuck.id}: ${err?.message}`,
        );
      }
    }

    return {
      success: true,
      userId,
      panelId,
      panelName: panel.name,
      requeuedRequestId,
    };
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
  }

  /**
   * Update a user's username (operator action)
   * This also updates targetUsername in all PENDING requests for this user
   */
  async updateUsername(userId: string, newUsername: string) {
    const normalizedUsername = newUsername.toLowerCase().trim();

    // Validate username format
    if (!PANEL_USERNAME_REGEX.test(normalizedUsername)) {
      throw new BadRequestException(PANEL_USERNAME_MESSAGE);
    }

    if (
      normalizedUsername.length < PANEL_USERNAME_MIN_LENGTH ||
      normalizedUsername.length > PANEL_USERNAME_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `El nombre de usuario debe tener entre ${PANEL_USERNAME_MIN_LENGTH} y ${PANEL_USERNAME_MAX_LENGTH} caracteres`,
      );
    }

    // Check if username already taken by another user
    const existing = await this.prisma.user.findFirst({
      where: {
        username: normalizedUsername,
        id: { not: userId },
      },
    });

    if (existing) {
      throw new ConflictException('Este nombre de usuario ya está en uso');
    }

    // Update user and their pending requests in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Update user's username
      const user = await tx.user.update({
        where: { id: userId },
        data: { username: normalizedUsername },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
        },
      });

      // Update targetUsername in pending requests
      const updatedRequests = await tx.request.updateMany({
        where: {
          userId,
          status: {
            in: [
              'PENDING_PROOF',
              'VALIDATING',
              'VALIDATION_FAILED',
              'APPROVED',
            ],
          },
        },
        data: { targetUsername: normalizedUsername },
      });

      return { user, updatedRequestsCount: updatedRequests.count };
    });

    return result;
  }

  /**
   * Operator action: change a user's phone number.
   *
   * Login requires the phone the user types to canonicalize to the stored one.
   * When the stored phone is wrong (bad CSV import, extra digits) the user
   * literally can't log in — so operators need a way to fix it. Stores the
   * phone in the same canonical form the login uses so the match works.
   */
  async updatePhone(userId: string, rawPhone: string, operatorId?: string) {
    const digits = (rawPhone || '').replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(digits)) {
      throw new BadRequestException(
        'El teléfono debe tener entre 7 y 15 dígitos',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, phone: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const canonicalPhone = canonicalArPhone(rawPhone);

    // Conflict: another user already owns this phone.
    //
    // No alcanza con comparar contra la forma canonica: hay ~46 usuarios cuyo
    // telefono quedo guardado SIN canonicalizar (ej. "2234666255" en vez de
    // "5492234666255"), de importaciones viejas. Comparando solo el canonico,
    // esos no colisionan nunca y se le puede asignar a alguien un numero que
    // ya es de otro — y como el login es usuario + telefono, quedan dos cuentas
    // con la misma identidad telefonica.
    //
    // Se traen los candidatos por el NSN (los 10 digitos finales, que es lo
    // unico estable entre formatos) y se comparan ya canonicalizados de los dos
    // lados, igual que hace el login en auth.service.
    const nsn = canonicalPhone.startsWith('549')
      ? canonicalPhone.slice(3)
      : canonicalPhone;
    const candidates = await this.prisma.user.findMany({
      where: { id: { not: userId }, phone: { contains: nsn } },
      select: { username: true, phone: true },
    });
    const phoneOwner = candidates.find(
      (c) => c.phone && canonicalArPhone(c.phone) === canonicalPhone,
    );
    if (phoneOwner) {
      throw new ConflictException(
        `Ese teléfono ya está en uso por "${phoneOwner.username}"`,
      );
    }

    const previousPhone = user.phone;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: canonicalPhone },
      select: { id: true, username: true, phone: true },
    });

    this.auditService
      .log({
        operatorId,
        action: AuditAction.USER_PHONE_CHANGED,
        entityType: EntityType.USER,
        entityId: userId,
        metadata: { previousPhone, newPhone: canonicalPhone },
      })
      .catch((err: any) =>
        this.logger.warn(`Failed to audit phone change: ${err?.message}`),
      );

    this.logger.log(
      `User ${user.username ?? userId} phone updated${
        previousPhone ? ` (was ${previousPhone})` : ''
      }`,
    );

    return { success: true, user: updated };
  }

  /**
   * Search CLIENT users for the operator panel (list + blacklist management).
   *
   * The old version loaded EVERY client (4000+) with all their completed
   * requests joined in, on every panel open — slow enough to time out the
   * socket ack, which left the Usuarios list empty and made search look broken.
   * Now: no query → the newest `limit` clients; a query → a real server-side
   * search by username/phone. Per-user load stats are computed with a single
   * groupBy over just the returned rows (not a per-user join). `counts` are the
   * global totals so the stats bar stays correct even though we only send a page.
   */
  async searchClients(query?: string, limit = 10) {
    const take = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const q = (query || '').trim();

    const where: any = { role: 'CLIENT' };
    if (q) {
      // Los telefonos se guardan canonicos ("549<area><nro>"), pero el operador
      // tipea como se lo dicta el usuario: con el 0 de larga distancia
      // ("02996735855") o con el 15 ("299 15 6735855"). Un `contains` crudo sobre
      // eso no matchea nunca. Buscamos por las dos formas: los digitos tal cual
      // (sirve para busquedas parciales) y la canonica.
      const digits = q.replace(/\D/g, '');
      const phoneTerms = new Set<string>();
      // Sólo se busca por teléfono si lo tipeado ES un teléfono.
      //
      // Antes bastaba con que la query tuviera algún dígito: buscar "acosta23"
      // extraía "23" y traía TODOS los teléfonos que contuvieran "23" — 50
      // personas sin relación, con la que el operador buscaba perdida en el
      // medio. Los nombres de usuario terminan en números casi siempre, así que
      // pasaba en casi todas las búsquedas.
      //
      // Un teléfono no tiene letras y tiene al menos 6 dígitos.
      const looksLikePhone = digits.length >= 6 && !/[a-zA-Z]/.test(q);
      if (looksLikePhone) {
        phoneTerms.add(digits);
        const canonical = canonicalArPhone(digits);
        if (canonical) phoneTerms.add(canonical);
      }

      where.OR = [
        { username: { contains: q, mode: 'insensitive' } },
        // El nombre en el panel de juego puede diferir del usuario de la app
        // (renombres, altas viejas). El operador no conoce esa distinción: para
        // él hay un solo nombre, y busca el que tiene a mano. Si sólo se mira
        // `username`, el usuario "no existe" y el operador lo da por perdido.
        { savedTargetUsername: { contains: q, mode: 'insensitive' } },
        ...[...phoneTerms].map((term) => ({ phone: { contains: term } })),
      ];
    }

    const [clients, total, active] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          phone: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          savedTargetUsername: true,
          panelId: true,
          panel: { select: { id: true, name: true } },
          _count: { select: { requests: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.user.count({ where: { role: 'CLIENT' } }),
      this.prisma.user.count({ where: { role: 'CLIENT', isActive: true } }),
    ]);

    // Load stats for just the returned users (one aggregate query, not a join).
    const userIds = clients.map((c) => c.id);
    const agg = userIds.length
      ? await this.prisma.request.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds }, status: 'COMPLETED' },
          _sum: { amount: true },
          _count: { _all: true },
          _min: { createdAt: true },
          _max: { createdAt: true },
        })
      : [];
    const byUser = new Map(agg.map((a) => [a.userId, a]));

    // Datos de cobro: el operador necesita el CBU/alias a mano para pagar
    // premios sin tener que abrir cada reclamo. Vive en PrizeClaim porque es
    // donde el usuario los carga. Una sola query acotada a los ids devueltos.
    const claims = userIds.length
      ? await this.prisma.prizeClaim.findMany({
          where: { userId: { in: userIds } },
          select: {
            userId: true,
            paymentMethod: true,
            paymentDetails: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    // El primero de cada usuario es el mas reciente (vienen ordenados desc).
    const payoutByUser = new Map<string, { method: string | null; details: any }>();
    for (const c of claims) {
      if (!c.paymentDetails) continue;
      if (!payoutByUser.has(c.userId)) {
        payoutByUser.set(c.userId, {
          method: c.paymentMethod,
          details: c.paymentDetails,
        });
      }
    }

    const data = clients.map((client) => {
      const a = byUser.get(client.id);
      const payout = payoutByUser.get(client.id);
      return {
        ...client,
        totalLoaded: a?._sum.amount ? Number(a._sum.amount) : 0,
        completedCount: a?._count._all ?? 0,
        firstLoadAt: a?._min.createdAt ?? null,
        lastLoadAt: a?._max.createdAt ?? null,
        payoutMethod: payout?.method ?? null,
        payoutDetails: payout?.details ?? null,
      };
    });

    return {
      data,
      counts: { total, active, blocked: total - active },
    };
  }

  /**
   * Toggle a user's active status (blacklist/unblacklist)
   * When deactivated, user cannot create new requests
   */
  async toggleUserActive(
    userId: string,
    isActive: boolean,
    operatorId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.role !== 'CLIENT') {
      throw new BadRequestException(
        'Solo se pueden bloquear/desbloquear usuarios de tipo CLIENT',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        username: true,
        phone: true,
        email: true,
        role: true,
        isActive: true,
        balance: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.log(
      `User ${userId} ${isActive ? 'activated' : 'deactivated'} by operator ${operatorId}`,
    );

    return updated;
  }

  async create(dto: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        role: dto.role,
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);

    const data: Record<string, unknown> = {};

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    if (dto.role !== undefined) {
      data.role = dto.role;
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.user.delete({
      where: { id },
    });

    return { deleted: true };
  }

  /**
   * Find an existing operator user by name, or auto-create one.
   * Used by OperatorGateway so operators don't need manual User creation.
   */
  async findOrCreateOperator(operatorName: string) {
    const normalized = operatorName.toLowerCase().trim();

    // Atomic upsert prevents race condition when multiple connections arrive simultaneously
    return this.prisma.user.upsert({
      where: { username: normalized },
      // Todo el que entra al panel de operadores es ADMIN, siempre.
      //
      // Antes esto era un no-op: si el User ya existía con otro rol (creado en
      // una versión anterior, o dado de alta como CLIENT), el operador quedaba
      // sin permisos para siempre y las acciones que piden rol —kill switch,
      // promos, settings, publicar actualización, reintentar una carga— le
      // respondían "Permisos insuficientes" sin explicar por qué.
      //
      // Es la misma gente, en la misma máquina, de la misma empresa: no hay
      // separación de permisos que sostener entre ellos.
      update: { role: UserRole.ADMIN },
      create: {
        username: normalized,
        role: UserRole.ADMIN,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
  }

  async getSavedTargetUsername(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedTargetUsername: true },
    });
    return user?.savedTargetUsername ?? null;
  }

  async setSavedTargetUsername(
    userId: string,
    targetUsername: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { savedTargetUsername: targetUsername.toLowerCase().trim() },
    });
  }

  /**
   * Change a user's panel-game username (savedTargetUsername) and, if the user has
   * a recent FAILED request waiting because of a name conflict, restart discovery
   * automatically with the new name. The caller is either the user themselves
   * (from chat-app) or an operator (from operator-panel / mobile).
   *
   * Also clears the stale `User.panelId`/`Request.panelId` so discovery starts
   * fresh — the user might exist in a panel under the new name.
   */
  /**
   * Renombra a un usuario manteniendo sus dos nombres sincronizados.
   *
   * `savedTargetUsername` es lo que la extension busca en el panel de juego
   * (`requests.service.ts:198` arma el targetUsername con
   * `savedTargetUsername ?? username`), y `username` es con lo que la persona
   * inicia sesion en la app. Si quedan distintos, el bot busca un nombre que no
   * existe en el panel y la carga falla.
   *
   * A diferencia de `changeSavedTargetUsernameWithRetry`, esto **no** resetea
   * `panelId` ni dispara discovery: es una correccion de nombre, no un cambio
   * de cuenta, y volver a descubrir manda al bot a recorrer todos los paneles
   * sin motivo.
   */
  async renameUser(userId: string, newName: string) {
    const normalized = (newName || '').trim().toLowerCase();

    if (normalized.length < 3 || normalized.length > 30) {
      throw new BadRequestException(
        'El nombre debe tener entre 3 y 30 caracteres',
      );
    }
    if (!/^[a-z0-9_]+$/.test(normalized)) {
      throw new BadRequestException(
        'Solo letras minusculas, numeros y guion bajo',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, savedTargetUsername: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (user.username === normalized && user.savedTargetUsername === normalized) {
      throw new BadRequestException('Ya se llama asi');
    }

    // `username` es unique y es la llave de login: si ya lo tiene otra cuenta
    // hay que avisar, no reventar con el error crudo de Prisma.
    const taken = await this.prisma.user.findFirst({
      where: { username: normalized, id: { not: userId } },
      select: { id: true, username: true },
    });
    if (taken) {
      throw new ConflictException(
        `Ya hay otra cuenta con el nombre "${normalized}"`,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { username: normalized, savedTargetUsername: normalized },
      select: {
        id: true,
        username: true,
        savedTargetUsername: true,
        phone: true,
        isActive: true,
        panelId: true,
      },
    });

    this.logger.log(
      `Usuario ${userId} renombrado: "${user.username}" -> "${normalized}" (username + savedTargetUsername)`,
    );

    return { success: true as const, user: updated };
  }


  async changeSavedTargetUsernameWithRetry(
    userId: string,
    newTargetUsername: string,
  ): Promise<{
    success: true;
    savedTargetUsername: string;
    retriedRequestId: string | null;
  }> {
    const normalized = newTargetUsername.trim().toLowerCase();
    if (normalized.length < 3 || normalized.length > 20) {
      throw new BadRequestException(
        'El nombre debe tener entre 3 y 20 caracteres',
      );
    }
    if (!/^[a-z0-9_]+$/.test(normalized)) {
      throw new BadRequestException('Solo letras, números y guion bajo');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, savedTargetUsername: true, panelId: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Sólo es "el mismo nombre" si YA coinciden los dos campos. Si difieren
    // (hay cuentas viejas asi), poner el que falta es justamente el arreglo.
    if (user.savedTargetUsername === normalized && user.username === normalized) {
      throw new BadRequestException(
        'Es el mismo nombre que ya tenés. Probá con otro.',
      );
    }

    // `username` es unique y ademas es con lo que la persona inicia sesion:
    // si el nombre ya lo tiene otra cuenta hay que avisar, no reventar con un
    // error de Prisma.
    const taken = await this.prisma.user.findFirst({
      where: { username: normalized, id: { not: userId } },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `Ya hay otra cuenta con el nombre "${normalized}"`,
      );
    }

    // Los dos campos se escriben juntos. `savedTargetUsername` es lo que la
    // extension busca en el panel de juego (requests.service.ts:198) y
    // `username` es con lo que la persona entra a la app: si quedan
    // desincronizados, el bot busca un nombre que no existe.
    //
    // Se resetea `panelId` porque el nombre nuevo puede vivir en otro panel y
    // hay que volver a descubrirlo.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        savedTargetUsername: normalized,
        username: normalized,
        panelId: null,
        // panelPassword stays unchanged — operator/user can update it via password change flow.
      },
    });

    this.logger.log(
      `User ${userId} renombrado a "${normalized}" (username + savedTargetUsername)`,
    );

    // If there's a recent FAILED request waiting for this user (most likely caused by
    // the username-taken conflict), restart it. Limit to the last hour to avoid
    // resurrecting unrelated old failures.
    const failedRequest = await this.prisma.request.findFirst({
      where: {
        userId,
        status: 'FAILED',
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    let retriedRequestId: string | null = null;
    if (failedRequest) {
      try {
        // Update the request's targetUsername to the new name + reset panelId/status,
        // then re-trigger discovery via DiscoveryService.
        await this.prisma.request.update({
          where: { id: failedRequest.id },
          data: {
            targetUsername: normalized,
            panelId: null,
            status: 'APPROVED',
          },
        });
        // Also delete any FAILED job linked to this request so re-discovery can
        // create a fresh one without colliding on the unique constraint.
        await this.prisma.job
          .deleteMany({ where: { requestId: failedRequest.id } })
          .catch(() => {});

        const { DiscoveryService } = require('../discovery/discovery.service');
        const discoveryService = this.moduleRef.get(DiscoveryService, {
          strict: false,
        });
        await discoveryService.startDiscovery(
          failedRequest.id,
          normalized,
          userId,
        );
        retriedRequestId = failedRequest.id;
        this.logger.log(
          `Re-triggered discovery for request ${failedRequest.id} with new username "${normalized}"`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to auto-retry request after username change: ${err.message}`,
        );
      }
    }

    return {
      success: true,
      savedTargetUsername: normalized,
      retriedRequestId,
    };
  }

  /**
   * Request a password change on the gaming panel.
   * Creates a CHANGE_PASSWORD job for the automation extension to execute.
   */
  async requestPasswordChange(
    userId: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres',
      );
    }
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, savedTargetUsername: true, panelId: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (!user.savedTargetUsername) {
      throw new BadRequestException(
        'No tienes un usuario de panel asociado. Primero realiza una carga para vincular tu cuenta.',
      );
    }

    // Check for existing pending password change job
    const existingJob = await this.prisma.job.findFirst({
      where: {
        type: 'CHANGE_PASSWORD',
        requestingUserId: userId,
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
    });

    if (existingJob) {
      throw new BadRequestException(
        'Ya tienes un cambio de contraseña en proceso. Espera a que termine.',
      );
    }

    // Create job for the automation extension
    const job = await this.prisma.job.create({
      data: {
        type: 'CHANGE_PASSWORD',
        status: 'QUEUED',
        targetUsername: user.savedTargetUsername,
        newPassword,
        requestingUserId: userId,
        // Sin panelId el job se despacha a cualquier panel conectado y la
        // búsqueda del usuario falla ("not found in search results").
        panelId: user.panelId ?? undefined,
      },
    });

    this.logger.log(
      `Password change job created: ${job.id} for user ${userId} (panel user: ${user.savedTargetUsername})`,
    );

    // Push notification — immediate "received" feedback so the user knows the request
    // landed (the final success/fail push fires later from bot.service.ts when the bot completes).
    this.pushService
      .sendToUser(
        userId,
        '🔄 Cambio de contraseña recibido',
        'Tu pedido entró en cola. Te avisamos cuando esté procesado.',
        { jobId: job.id, type: 'password_change_queued' },
      )
      .catch((err: any) =>
        this.logger.warn(
          `Push (password_change_queued) failed: ${err.message}`,
        ),
      );

    return {
      success: true,
      message:
        'Tu cambio de contraseña está en proceso. Te avisaremos cuando esté listo.',
      jobId: job.id,
    };
  }

  /**
   * Request creation of a new user on the gaming panel.
   * Creates a CREATE_USER job for the automation extension to execute.
   * Called by operators from the operator panel or mobile app.
   */
  async requestCreateUser(targetUsername: string) {
    const normalized = (targetUsername || '').toLowerCase().trim();

    // El nombre viaja al bot, que lo tipea tal cual en el panel externo: si acá
    // entra con espacios o signos se crea una cuenta que después el usuario no
    // puede usar para loguearse, porque el login sí valida el formato.
    if (normalized.length < PANEL_USERNAME_MIN_LENGTH) {
      throw new BadRequestException(
        `El nombre de usuario debe tener al menos ${PANEL_USERNAME_MIN_LENGTH} caracteres`,
      );
    }
    if (normalized.length > PANEL_USERNAME_MAX_LENGTH) {
      throw new BadRequestException(
        `El nombre de usuario no puede tener más de ${PANEL_USERNAME_MAX_LENGTH} caracteres`,
      );
    }
    if (!PANEL_USERNAME_REGEX.test(normalized)) {
      throw new BadRequestException(PANEL_USERNAME_MESSAGE);
    }

    // Check for existing pending CREATE_USER job for this username
    const existingJob = await this.prisma.job.findFirst({
      where: {
        type: 'CREATE_USER',
        targetUsername: normalized,
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
    });

    if (existingJob) {
      throw new BadRequestException(
        `Ya hay una creación de usuario en proceso para "${normalized}".`,
      );
    }

    const job = await this.prisma.job.create({
      data: {
        type: 'CREATE_USER',
        status: 'QUEUED',
        targetUsername: normalized,
        newPassword: '123casino',
      },
    });

    this.logger.log(
      `Create user job created: ${job.id} for panel user: ${normalized}`,
    );

    return {
      success: true,
      message: `Creación de usuario "${normalized}" en proceso.`,
      jobId: job.id,
    };
  }

  // ============================================
  // PRELOADED USERS
  // ============================================

  /**
   * Bulk import preloaded users from operator CSV.
   * - Validates each entry (username 3-30 chars, phone 7-15 digits).
   * - Upserts: if username exists, updates phone+panelId+isPreloaded; if not, creates.
   * - Conflicts (phone already used by a different username) are skipped + reported.
   */
  async bulkImportPreloaded(
    entries: Array<{ username: string; phone: string; panelId?: string }>,
    operatorUserId: string,
  ) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new BadRequestException('No se enviaron filas para importar');
    }
    if (entries.length > 5000) {
      throw new BadRequestException('Máximo 5000 filas por importación');
    }

    const created: string[] = [];
    const updated: string[] = [];
    const errors: Array<{ row: number; username?: string; error: string }> = [];

    for (let i = 0; i < entries.length; i++) {
      const raw = entries[i];
      const row = i + 1;
      const username = (raw.username || '').toString().trim().toLowerCase();
      const phone = (raw.phone || '').toString().trim();
      const panelId = (raw.panelId || '').toString().trim() || null;

      if (!username || username.length < 3 || username.length > 30) {
        errors.push({
          row,
          username,
          error: 'Username inválido (3-30 caracteres)',
        });
        continue;
      }
      if (!/^[a-z0-9_][a-z0-9_]*$/.test(username)) {
        errors.push({
          row,
          username,
          error: 'Username solo letras, números y guión bajo',
        });
        continue;
      }
      if (!phone || !/^\d{7,15}$/.test(phone.replace(/\D/g, ''))) {
        errors.push({
          row,
          username,
          error: 'Teléfono inválido (7-15 dígitos)',
        });
        continue;
      }

      try {
        // Canonical Argentine format: 549<area><number>. Accepts any input
        // (with/without "+", "54", "9", area code only, etc.).
        const cleanPhone = canonicalArPhone(phone);

        // Conflict: phone already used by a different username
        const phoneOwner = await this.prisma.user.findUnique({
          where: { phone: cleanPhone },
        });
        if (phoneOwner && phoneOwner.username !== username) {
          errors.push({
            row,
            username,
            error: `Teléfono ya usado por "${phoneOwner.username}"`,
          });
          continue;
        }

        // Case-insensitive lookup: "Adrian" and "adrian" treated as the same user.
        const existing = await this.prisma.user.findFirst({
          where: { username: { equals: username, mode: 'insensitive' } },
        });
        if (existing) {
          await this.prisma.user.update({
            where: { id: existing.id },
            data: {
              phone: cleanPhone,
              panelId: panelId || existing.panelId,
              isPreloaded: true,
              preloadedAt: new Date(),
              preloadedBy: operatorUserId,
            },
          });
          updated.push(username);
        } else {
          await this.prisma.user.create({
            data: {
              username,
              phone: cleanPhone,
              panelId,
              role: UserRole.CLIENT,
              savedTargetUsername: username,
              isPreloaded: true,
              preloadedAt: new Date(),
              preloadedBy: operatorUserId,
            },
          });
          created.push(username);
        }
      } catch (err: any) {
        errors.push({
          row,
          username,
          error: err.message || 'Error desconocido',
        });
      }
    }

    this.logger.log(
      `Bulk preload by ${operatorUserId}: created=${created.length}, updated=${updated.length}, errors=${errors.length}`,
    );

    return {
      created: created.length,
      updated: updated.length,
      errors,
      createdUsernames: created,
      updatedUsernames: updated,
    };
  }

  /** Returns all users currently marked as preloaded, latest first. */
  async findPreloaded() {
    return this.prisma.user.findMany({
      where: { isPreloaded: true },
      select: {
        id: true,
        username: true,
        phone: true,
        panelId: true,
        preloadedAt: true,
        preloadedBy: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { preloadedAt: 'desc' },
    });
  }

  /** Removes the preloaded flag (does not delete the User row). */
  async unflagPreloaded(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.prisma.user.update({
      where: { id: userId },
      data: { isPreloaded: false },
    });
    return { success: true };
  }
}
