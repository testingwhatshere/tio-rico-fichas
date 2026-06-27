import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
  };
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    };
    jwtService = { sign: jest.fn().mockReturnValue('mock-jwt-token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should register a new user and return token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        role: 'CLIENT',
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

      const result = await service.register({
        email: 'test@test.com',
        password: 'password123',
      });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe('test@test.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });

    it('should throw ConflictException if email exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({ email: 'taken@test.com', password: 'pass' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should login with valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        role: 'OPERATOR',
        isActive: true,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'test@test.com',
        password: 'correct-password',
      });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.role).toBe('OPERATOR');
    });

    it('should throw if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nope@test.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if account is disabled', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        role: 'CLIENT',
        isActive: false,
      });

      await expect(
        service.login({ email: 'test@test.com', password: 'pass' }),
      ).rejects.toThrow('Account is disabled');
    });

    it('should throw if user has no password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: null,
        role: 'CLIENT',
        isActive: true,
      });

      await expect(
        service.login({ email: 'test@test.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        role: 'OPERATOR',
        isActive: true,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('clientAuth', () => {
    it('should login existing client by username', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        username: 'juan_perez',
        savedTargetUsername: 'juan_perez',
        role: 'CLIENT',
        isActive: true,
        phone: '1155667788',
      });

      const result = await service.clientAuth({
        username: 'Juan_Perez',
        phone: '1155667788',
      });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.username).toBe('juan_perez');
      expect(result.user.savedTargetUsername).toBe('juan_perez');
      // Username is normalized to lowercase, lookup is case-insensitive
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            username: { equals: 'juan_perez', mode: 'insensitive' },
          },
        }),
      );
    });

    it('should throw if existing client is disabled', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        username: 'disabled',
        savedTargetUsername: 'disabled',
        role: 'CLIENT',
        isActive: false,
        phone: '1155667788',
      });

      await expect(
        service.clientAuth({ username: 'disabled', phone: '1155667788' }),
      ).rejects.toThrow('Cuenta deshabilitada');
    });

    it('should require phone for new users', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.clientAuth({ username: 'new_user' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should register new user with phone', async () => {
      prisma.user.findFirst.mockResolvedValue(null); // username lookup
      prisma.user.findUnique.mockResolvedValue(null); // phone lookup
      prisma.user.create.mockResolvedValue({
        id: 'new-user',
        username: 'new_user',
        savedTargetUsername: 'new_user',
        role: 'CLIENT',
        isActive: true,
      });

      const result = await service.clientAuth({
        username: 'new_user',
        phone: '1155667788',
      });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'new_user',
            // Phone is canonicalized to "549<area><number>"
            phone: '5491155667788',
            role: 'CLIENT',
          }),
        }),
      );
    });

    it('should reject reserved usernames', async () => {
      await expect(service.clientAuth({ username: 'admin' })).rejects.toThrow(
        BadRequestException,
      );

      await expect(
        service.clientAuth({ username: 'OPERATOR' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject duplicate phone numbers', async () => {
      prisma.user.findFirst.mockResolvedValue(null); // username: new
      prisma.user.findUnique.mockResolvedValue({ id: 'other-user' }); // phone: taken

      await expect(
        service.clientAuth({ username: 'new_user', phone: '1155667788' }),
      ).rejects.toThrow('ya está registrado');
    });
  });

  describe('validateUser', () => {
    it('should return user if active', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@test.com',
        username: 'test',
        role: 'CLIENT',
        isActive: true,
        balance: '5000',
      };
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.validateUser('user-1');

      expect(result).toEqual(mockUser);
    });

    it('should throw if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.validateUser('nope')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw if user is inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isActive: false,
      });

      await expect(service.validateUser('user-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
