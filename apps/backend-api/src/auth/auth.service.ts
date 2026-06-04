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
    'admin', 'administrator', 'system', 'bot', 'operator',
    'support', 'soporte', 'root', 'moderator', 'mod',
    'staff', 'help', 'info', 'null', 'undefined',
    'api', 'test', 'demo', 'guest',
  ];

  // Mar del Plata — area code blocked from registration
  private static readonly BLOCKED_AREA_CODES = ['223'];

  async clientAuth(dto: ClientAuthDto): Promise<AuthResponseDto> {
    const normalizedUsername = dto.username.toLowerCase();

    // Fix 20: Check reserved usernames
    if (AuthService.RESERVED_USERNAMES.includes(normalizedUsername)) {
      throw new BadRequestException('Este nombre de usuario está reservado');
    }

    // Try to find existing user by username
    let user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
      },
    });

    // If user exists → login as normal (phone not needed)
    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Cuenta deshabilitada');
      }

      // Trigger discovery for existing users without panel (fire-and-forget)
      this.triggerPanelDiscovery(user.id, normalizedUsername).catch((err) =>
      this.logger.warn(`Discovery failed for ${normalizedUsername}: ${err.message}`),
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
          role: user.role,
        },
      };
    }

    // User doesn't exist → registration flow, phone is required
    if (!dto.phone) {
      throw new BadRequestException({
        message: 'PHONE_REQUIRED',
        statusCode: 400,
        needsPhone: true,
      });
    }

    // Normalize phone: strip spaces and leading +
    const normalizedPhone = dto.phone.replace(/\s+/g, '');

    // Block Mar del Plata + zona costera area codes
    const cleanPhone = normalizedPhone.replace(/^\+/, '');
    const isBlockedRegion = AuthService.BLOCKED_AREA_CODES.some(code =>
      cleanPhone.startsWith(code) ||
      cleanPhone.startsWith('54' + code) ||
      cleanPhone.startsWith('549' + code),
    );
    if (isBlockedRegion) {
      throw new BadRequestException('El sistema no está disponible en tu región');
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
    try {
      user = await this.prisma.user.create({
        data: {
          username: normalizedUsername,
          phone: normalizedPhone,
          role: 'CLIENT',
          savedTargetUsername: normalizedUsername,
        },
        select: {
          id: true,
          username: true,
          role: true,
          isActive: true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        // Concurrent creation — could be username or phone unique constraint
        // Re-fetch to see if our username was created
        user = await this.prisma.user.findUnique({
          where: { username: normalizedUsername },
          select: { id: true, username: true, role: true, isActive: true },
        });
        if (!user) {
          throw new BadRequestException('Error al crear usuario, intentá de nuevo');
        }
      } else {
        throw error;
      }
    }

    // Check if account is active
    if (!user.isActive) {
      throw new UnauthorizedException('Cuenta deshabilitada');
    }

    // Trigger panel discovery for new users (fire-and-forget, don't block login)
    this.triggerPanelDiscovery(user.id, normalizedUsername).catch((err) =>
      this.logger.warn(`Discovery failed for ${normalizedUsername}: ${err.message}`),
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
        role: user.role,
      },
    };
  }

  /**
   * Trigger panel discovery for a user — search all panels, create if not found.
   * Fire-and-forget: runs in background, doesn't block auth response.
   */
  private async triggerPanelDiscovery(userId: string, targetUsername: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { panelId: true },
      });
      if (user?.panelId) return; // Already assigned to a panel

      const { DiscoveryService } = require('../discovery/discovery.service');
      const discoveryService = this.moduleRef.get(DiscoveryService, { strict: false });
      await discoveryService.discoverUser(userId, targetUsername);
      this.logger.log(`Panel discovery triggered for new user ${userId} (${targetUsername})`);
    } catch (error: any) {
      this.logger.warn(`Panel discovery failed for ${targetUsername}: ${error.message}`);
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

  private generateToken(user: { id: string; email?: string; username?: string; role: string }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role as JwtPayload['role'],
    };

    return this.jwtService.sign(payload);
  }
}
