import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ModuleRef } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto, AuthResponseDto, ClientAuthDto } from './dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { canonicalArPhone } from '../common/utils/phone.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
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
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    // Email is guaranteed non-null since we just created it with dto.email
    const token = this.generateToken({
      id: user.id,
      email: user.email!,
      role: user.role,
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email!,
        role: user.role,
      },
    };
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    // Password is required for login (operators/admins only)
    if (!user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.generateToken({ ...user, email: user.email || '' });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email || '',
        role: user.role,
      },
    };
  }

  /**
   * Simple client authentication - username only (no password)
   * Creates user if doesn't exist, returns token if exists
   * Only for CLIENT role users
   */
  // Fix 20: Reserved usernames that cannot be registered by clients
  private static readonly RESERVED_USERNAMES = [
    'admin',
    'administrator',
    'system',
    'bot',
    'operator',
    'support',
    'soporte',
    'root',
    'moderator',
    'mod',
    'staff',
    'help',
    'info',
    'null',
    'undefined',
    'api',
    'test',
    'demo',
    'guest',
  ];

  // Mar del Plata — area code blocked from registration
  private static readonly BLOCKED_AREA_CODES = ['223'];

  /**
   * Normalize Argentine phone numbers to canonical form `549<area><number>`.
   * Delegates to the shared util (single source of truth shared with the user
   * preload/import path) so equal numbers always canonicalize identically.
   * Kept as a static method to preserve existing `AuthService.canonicalArPhone`
   * call sites.
   */
  static canonicalArPhone(raw: string): string {
    return canonicalArPhone(raw);
  }

  async clientAuth(dto: ClientAuthDto): Promise<AuthResponseDto> {
    const normalizedUsername = dto.username.toLowerCase().trim();

    // Fix 20: Check reserved usernames
    if (AuthService.RESERVED_USERNAMES.includes(normalizedUsername)) {
      throw new BadRequestException('Este nombre de usuario está reservado');
    }

    // Phone is REQUIRED on every login/register, no exceptions (anti-fraud).
    if (!dto.phone) {
      throw new BadRequestException({
        message: 'PHONE_REQUIRED',
        statusCode: 400,
        needsPhone: true,
      });
    }

    // Case-insensitive lookup as safety net for legacy records that may have mixed case.
    let user = await this.prisma.user.findFirst({
      where: { username: { equals: normalizedUsername, mode: 'insensitive' } },
      select: {
        id: true,
        username: true,
        savedTargetUsername: true,
        role: true,
        isActive: true,
        isPreloaded: true,
        phone: true,
      },
    });

    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Cuenta deshabilitada');
      }

      // Every existing user must prove the phone matches what's stored. Both
      // sides canonicalized to "549<area><number>" so the user can type any
      // common Argentine format ("1134...", "9 11 34...", "+5491134...").
      if (user.phone) {
        const providedPhone = AuthService.canonicalArPhone(dto.phone);
        const expectedPhone = AuthService.canonicalArPhone(user.phone);
        if (providedPhone !== expectedPhone) {
          this.logger.warn(
            `User "${normalizedUsername}" login rejected: phone mismatch`,
          );
          throw new UnauthorizedException(
            'El número de teléfono no coincide con el registrado. Si es tu cuenta, contactá a soporte.',
          );
        }
      } else {
        // Legacy account without phone on record: backfill on this login.
        const normalizedPhone = AuthService.canonicalArPhone(dto.phone);
        const existingPhoneUser = await this.prisma.user.findUnique({
          where: { phone: normalizedPhone },
        });
        if (existingPhoneUser && existingPhoneUser.id !== user.id) {
          throw new BadRequestException(
            'Este número de teléfono ya está registrado con otro usuario',
          );
        }
        await this.prisma.user.update({
          where: { id: user.id },
          data: { phone: normalizedPhone },
        });
      }

      // Trigger discovery for existing users without panel (fire-and-forget)
      this.triggerPanelDiscovery(user.id, normalizedUsername).catch((err) =>
        this.logger.warn(
          `Discovery failed for ${normalizedUsername}: ${err.message}`,
        ),
      );

      const token = this.generateToken({
        id: user.id,
        email: user.username || '',
        role: user.role,
      });

      return {
        accessToken: token,
        user: {
          id: user.id,
          email: user.username || '',
          username: user.username || '',
          savedTargetUsername: user.savedTargetUsername || user.username || '',
          role: user.role,
        },
      };
    }

    // Normalize phone to canonical Argentine format "549<area><number>".
    // This collapses any equivalent input the user might type into a single
    // canonical key, so uniqueness checks catch duplicates.
    const normalizedPhone = AuthService.canonicalArPhone(dto.phone);

    // Block Mar del Plata + zona costera area codes (canonical form starts with 549<area>)
    const isBlockedRegion = AuthService.BLOCKED_AREA_CODES.some((code) =>
      normalizedPhone.startsWith('549' + code),
    );
    if (isBlockedRegion) {
      throw new BadRequestException(
        'El sistema no está disponible en tu región',
      );
    }

    // Check if phone is already used by another user
    const existingPhoneUser = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
    });

    if (existingPhoneUser) {
      throw new BadRequestException(
        'Este número de teléfono ya está registrado con otro usuario',
      );
    }

    // Create new CLIENT user with username + phone
    // savedTargetUsername = username (they're the same — the gaming panel username)
    type UserShape = {
      id: string;
      username: string | null;
      savedTargetUsername: string | null;
      phone: string | null;
      role: 'CLIENT' | 'OPERATOR' | 'SENIOR_OPERATOR' | 'ADMIN';
      isActive: boolean;
      isPreloaded: boolean;
    };
    const userSelect = {
      id: true,
      username: true,
      savedTargetUsername: true,
      role: true,
      isActive: true,
      isPreloaded: true,
      phone: true,
    } as const;

    let createdOrFound: UserShape | null = null;
    try {
      createdOrFound = (await this.prisma.user.create({
        data: {
          username: normalizedUsername,
          phone: normalizedPhone,
          role: 'CLIENT',
          savedTargetUsername: normalizedUsername,
        },
        select: userSelect,
      })) as UserShape;
    } catch (error: any) {
      if (error.code === 'P2002') {
        // Concurrent creation — could be username or phone unique constraint
        // Re-fetch case-insensitively to find any variant of the username.
        createdOrFound = (await this.prisma.user.findFirst({
          where: {
            username: { equals: normalizedUsername, mode: 'insensitive' },
          },
          select: userSelect,
        })) as UserShape | null;
        if (!createdOrFound) {
          throw new BadRequestException(
            'Error al crear usuario, intentá de nuevo',
          );
        }
      } else {
        throw error;
      }
    }
    if (!createdOrFound) {
      throw new BadRequestException('Error al crear usuario, intentá de nuevo');
    }
    user = createdOrFound;

    // Check if account is active
    if (!user.isActive) {
      throw new UnauthorizedException('Cuenta deshabilitada');
    }

    // Trigger panel discovery for new users (fire-and-forget, don't block login)
    this.triggerPanelDiscovery(user.id, normalizedUsername).catch((err) =>
      this.logger.warn(
        `Discovery failed for ${normalizedUsername}: ${err.message}`,
      ),
    );

    // Generate token using username as identifier
    const token = this.generateToken({
      id: user.id,
      email: user.username || '', // Use username as email for JWT compatibility
      role: user.role,
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.username || '', // Return username as email for frontend compatibility
        username: user.username || '',
        savedTargetUsername: user.savedTargetUsername || user.username || '',
        role: user.role,
      },
    };
  }

  /**
   * Trigger panel discovery for a user — search all panels, create if not found.
   * Fire-and-forget: runs in background, doesn't block auth response.
   */
  private async triggerPanelDiscovery(
    userId: string,
    targetUsername: string,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { panelId: true },
      });
      if (user?.panelId) return; // Already assigned to a panel

      const { DiscoveryService } = require('../discovery/discovery.service');
      const discoveryService = this.moduleRef.get(DiscoveryService, {
        strict: false,
      });
      await discoveryService.discoverUser(userId, targetUsername);
      this.logger.log(
        `Panel discovery triggered for new user ${userId} (${targetUsername})`,
      );
    } catch (error: any) {
      this.logger.warn(
        `Panel discovery failed for ${targetUsername}: ${error.message}`,
      );
    }
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        balance: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return user;
  }

  private generateToken(user: {
    id: string;
    email?: string;
    username?: string;
    role: string;
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role as JwtPayload['role'],
    };

    return this.jwtService.sign(payload);
  }
}
