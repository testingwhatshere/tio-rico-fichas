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

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

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
}
