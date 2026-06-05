import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { PushService } from '../notifications/push.service';

/**
 * Conservative Argentine phone normalizer.
 * Returns canonical "549<area><number>" when the input is clearly AR;
 * leaves foreign-looking numbers (Chile +56, Spain +34, etc.) as digit-only.
 */
function canonicalArPhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54') && digits.length >= 11 && digits.length <= 13) {
    return '549' + digits.slice(2);
  }
  if (digits.startsWith('9') && digits.length >= 10 && digits.length <= 12) {
    return '54' + digits;
  }
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('0')) {
    return '549' + digits;
  }
  return digits;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
  ) {}

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
    if (!/^[a-zA-Z0-9_]+$/.test(normalizedUsername)) {
      throw new BadRequestException(
        'El nombre de usuario solo puede contener letras, números y guiones bajos',
      );
    }

    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
      throw new BadRequestException(
        'El nombre de usuario debe tener entre 3 y 30 caracteres',
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
          status: { in: ['PENDING_PROOF', 'VALIDATING', 'VALIDATION_FAILED', 'APPROVED'] },
        },
        data: { targetUsername: normalizedUsername },
      });

      return { user, updatedRequestsCount: updatedRequests.count };
    });

    return result;
  }

  /**
   * Get all CLIENT users for operator panel (blacklist management)
   */
  async getAllClients() {
    const clients = await this.prisma.user.findMany({
      where: { role: 'CLIENT' },
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
        savedTargetUsername: true,
        _count: {
          select: {
            requests: true,
          },
        },
        requests: {
          where: { status: 'COMPLETED' },
          select: { amount: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return clients.map((client) => {
      const completed = client.requests || [];
      const totalLoaded = completed.reduce((sum, r) => sum + Number(r.amount), 0);
      const firstLoadAt = completed[0]?.createdAt || null;
      const lastLoadAt = completed.length > 0 ? completed[completed.length - 1].createdAt : null;
      const { requests: _omit, ...rest } = client;
      return { ...rest, totalLoaded, completedCount: completed.length, firstLoadAt, lastLoadAt };
    });
  }

  /**
   * Toggle a user's active status (blacklist/unblacklist)
   * When deactivated, user cannot create new requests
   */
  async toggleUserActive(userId: string, isActive: boolean, operatorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.role !== 'CLIENT') {
      throw new BadRequestException('Solo se pueden bloquear/desbloquear usuarios de tipo CLIENT');
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
      update: {}, // no-op if already exists
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

  async setSavedTargetUsername(userId: string, targetUsername: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { savedTargetUsername: targetUsername.toLowerCase().trim() },
    });
  }

  /**
   * Request a password change on the gaming panel.
   * Creates a CHANGE_PASSWORD job for the automation extension to execute.
   */
  async requestPasswordChange(userId: string, newPassword: string, confirmPassword: string) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres');
    }
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, savedTargetUsername: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (!user.savedTargetUsername) {
      throw new BadRequestException('No tienes un usuario de panel asociado. Primero realiza una carga para vincular tu cuenta.');
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
      throw new BadRequestException('Ya tienes un cambio de contraseña en proceso. Espera a que termine.');
    }

    // Create job for the automation extension
    const job = await this.prisma.job.create({
      data: {
        type: 'CHANGE_PASSWORD',
        status: 'QUEUED',
        targetUsername: user.savedTargetUsername,
        newPassword,
        requestingUserId: userId,
      },
    });

    this.logger.log(`Password change job created: ${job.id} for user ${userId} (panel user: ${user.savedTargetUsername})`);

    // Push notification — immediate "received" feedback so the user knows the request
    // landed (the final success/fail push fires later from bot.service.ts when the bot completes).
    this.pushService
      .sendToUser(
        userId,
        '🔄 Cambio de contraseña recibido',
        'Tu pedido entró en cola. Te avisamos cuando esté procesado.',
        { jobId: job.id, type: 'password_change_queued' },
      )
      .catch((err: any) => this.logger.warn(`Push (password_change_queued) failed: ${err.message}`));

    return {
      success: true,
      message: 'Tu cambio de contraseña está en proceso. Te avisaremos cuando esté listo.',
      jobId: job.id,
    };
  }

  /**
   * Request creation of a new user on the gaming panel.
   * Creates a CREATE_USER job for the automation extension to execute.
   * Called by operators from the operator panel or mobile app.
   */
  async requestCreateUser(targetUsername: string) {
    if (!targetUsername || targetUsername.trim().length < 3) {
      throw new BadRequestException('El nombre de usuario debe tener al menos 3 caracteres');
    }

    const normalized = targetUsername.toLowerCase().trim();

    // Check for existing pending CREATE_USER job for this username
    const existingJob = await this.prisma.job.findFirst({
      where: {
        type: 'CREATE_USER',
        targetUsername: normalized,
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
    });

    if (existingJob) {
      throw new BadRequestException(`Ya hay una creación de usuario en proceso para "${normalized}".`);
    }

    const job = await this.prisma.job.create({
      data: {
        type: 'CREATE_USER',
        status: 'QUEUED',
        targetUsername: normalized,
        newPassword: '123casino',
      },
    });

    this.logger.log(`Create user job created: ${job.id} for panel user: ${normalized}`);

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
        errors.push({ row, username, error: 'Username inválido (3-30 caracteres)' });
        continue;
      }
      if (!/^[a-z0-9_][a-z0-9_]*$/.test(username)) {
        errors.push({ row, username, error: 'Username solo letras, números y guión bajo' });
        continue;
      }
      if (!phone || !/^\d{7,15}$/.test(phone.replace(/\D/g, ''))) {
        errors.push({ row, username, error: 'Teléfono inválido (7-15 dígitos)' });
        continue;
      }

      try {
        // Canonical Argentine format: 549<area><number>. Accepts any input
        // (with/without "+", "54", "9", area code only, etc.).
        const cleanPhone = canonicalArPhone(phone);

        // Conflict: phone already used by a different username
        const phoneOwner = await this.prisma.user.findUnique({ where: { phone: cleanPhone } });
        if (phoneOwner && phoneOwner.username !== username) {
          errors.push({ row, username, error: `Teléfono ya usado por "${phoneOwner.username}"` });
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
        errors.push({ row, username, error: err.message || 'Error desconocido' });
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
