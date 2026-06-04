import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BalanceService } from '../balance/balance.service';
import { EventsGateway } from '../events/events.gateway';
import { CreateWithdrawalDto, ApproveWithdrawalDto, RejectWithdrawalDto } from './dto';
import { MIN_WITHDRAWAL_AMOUNT } from '../common/constants/timeouts';

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceService: BalanceService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly events: EventsGateway,
  ) {}

  async create(userId: string, dto: CreateWithdrawalDto) {
    if (dto.amount < MIN_WITHDRAWAL_AMOUNT) {
      throw new BadRequestException(`El monto mínimo de retiro es $${MIN_WITHDRAWAL_AMOUNT}`);
    }

    let withdrawal: any;
    try {
      withdrawal = await this.prisma.$transaction(
        async (tx) => {
          // Check balance inside transaction
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { balance: true },
          });

          if (!user) {
            throw new BadRequestException('Usuario no encontrado');
          }

          if (Number(user.balance) < dto.amount) {
            throw new BadRequestException(
              `Saldo insuficiente. Tu saldo actual es $${Number(user.balance).toLocaleString('es-AR')}`,
            );
          }

          // Check for existing pending withdrawal inside transaction
          const existingPending = await tx.withdrawal.findFirst({
            where: {
              userId,
              status: 'PENDING_APPROVAL',
            },
          });

          if (existingPending) {
            throw new BadRequestException(
              'Ya tienes una solicitud de retiro pendiente. Espera a que sea procesada.',
            );
          }

          // Create withdrawal
          return tx.withdrawal.create({
            data: {
              userId,
              amount: dto.amount,
              paymentMethod: dto.paymentMethod,
              paymentDetails: dto.paymentDetails,
              status: 'PENDING_APPROVAL',
            },
            include: {
              user: { select: { id: true, username: true, email: true } },
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException('Solicitud concurrente detectada. Reintentá.');
      }
      throw error;
    }

    this.logger.log(`Withdrawal created: ${withdrawal.id} for user ${userId}`);

    // Emit events after commit (Fix 45)
    this.events.emitToUser(userId, 'withdrawal:created', {
      withdrawalId: withdrawal.id,
      amount: Number(withdrawal.amount),
      status: withdrawal.status,
      timestamp: new Date().toISOString(),
    });
    this.events.emitToOperators('withdrawal:created', {
      withdrawalId: withdrawal.id,
      userId,
      amount: Number(withdrawal.amount),
      status: withdrawal.status,
      timestamp: new Date().toISOString(),
    });

    return withdrawal;
  }

  async findAllByUser(userId: string) {
    return this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId?: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Retiro no encontrado');
    }

    // If userId is provided, verify ownership
    if (userId && withdrawal.userId !== userId) {
      throw new ForbiddenException('No tienes acceso a este retiro');
    }

    return withdrawal;
  }

  async approve(id: string, operatorId: string, dto?: ApproveWithdrawalDto) {
    let updated: any;
    let withdrawalUserId: string;
    let withdrawalAmount: number;

    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          // Read withdrawal inside transaction
          const withdrawal = await tx.withdrawal.findUnique({
            where: { id },
          });

          if (!withdrawal) {
            throw new NotFoundException('Retiro no encontrado');
          }

          if (withdrawal.status !== 'PENDING_APPROVAL') {
            throw new BadRequestException(
              'Este retiro no puede ser aprobado en su estado actual',
            );
          }

          withdrawalUserId = withdrawal.userId;
          withdrawalAmount = Number(withdrawal.amount);

          // Atomic balance deduction with non-negative guard
          const result = await tx.$queryRaw<{ balance: any }[]>`
            UPDATE "User"
            SET balance = balance - ${withdrawalAmount}::decimal,
                "updatedAt" = NOW()
            WHERE id = ${withdrawal.userId}
              AND balance >= ${withdrawalAmount}::decimal
            RETURNING balance
          `;

          if (result.length === 0) {
            throw new BadRequestException(
              'El usuario ya no tiene saldo suficiente para este retiro',
            );
          }

          const balanceAfter = Number(result[0].balance);
          const balanceBefore = balanceAfter + withdrawalAmount;

          // Update withdrawal status
          const approvedWithdrawal = await tx.withdrawal.update({
            where: { id },
            data: {
              status: 'APPROVED',
              approvedBy: operatorId,
              approvedAt: new Date(),
            },
          });

          // Create transaction record
          await tx.transaction.create({
            data: {
              userId: withdrawal.userId,
              type: 'WITHDRAWAL',
              amount: new Decimal(-withdrawalAmount),
              balanceBefore: new Decimal(balanceBefore),
              balanceAfter: new Decimal(balanceAfter),
              withdrawalId: withdrawal.id,
              description: `Retiro de ${withdrawal.paymentMethod} - Aprobado`,
            },
          });

          return approvedWithdrawal;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException(
          'Este retiro fue modificado por otro operador. Reintentá.',
        );
      }
      throw error;
    }

    this.logger.log(
      `Withdrawal ${id} approved by operator ${operatorId}, balance deducted`,
    );

    // Emit events after commit (Fix 45)
    this.events.emitToUser(withdrawalUserId!, 'withdrawal:approved', {
      withdrawalId: id,
      amount: withdrawalAmount!,
      timestamp: new Date().toISOString(),
    });
    this.events.emitToOperators('withdrawal:approved', {
      withdrawalId: id,
      userId: withdrawalUserId!,
      amount: withdrawalAmount!,
      operatorId,
      timestamp: new Date().toISOString(),
    });
    this.events.emitDashboardUpdate();

    return updated;
  }

  async reject(id: string, operatorId: string, dto: RejectWithdrawalDto) {
    let updated: any;
    let withdrawalUserId: string;

    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const withdrawal = await tx.withdrawal.findUnique({
            where: { id },
          });

          if (!withdrawal) {
            throw new NotFoundException('Retiro no encontrado');
          }

          if (withdrawal.status !== 'PENDING_APPROVAL') {
            throw new BadRequestException(
              'Este retiro no puede ser rechazado en su estado actual',
            );
          }

          withdrawalUserId = withdrawal.userId;

          return tx.withdrawal.update({
            where: { id },
            data: {
              status: 'REJECTED',
              approvedBy: operatorId,
              approvedAt: new Date(),
              rejectedReason: dto.reason,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException(
          'Este retiro fue modificado por otro operador. Reintentá.',
        );
      }
      throw error;
    }

    this.logger.log(
      `Withdrawal ${id} rejected by operator ${operatorId}: ${dto.reason}`,
    );

    // Emit events after commit (Fix 45)
    this.events.emitToUser(withdrawalUserId!, 'withdrawal:rejected', {
      withdrawalId: id,
      reason: dto.reason,
      timestamp: new Date().toISOString(),
    });
    this.events.emitToOperators('withdrawal:rejected', {
      withdrawalId: id,
      userId: withdrawalUserId!,
      operatorId,
      reason: dto.reason,
      timestamp: new Date().toISOString(),
    });
    this.events.emitDashboardUpdate();

    return updated;
  }

  async complete(id: string, operatorId: string) {
    let updated: any;
    let withdrawalUserId: string;

    try {
      updated = await this.prisma.$transaction(
        async (tx) => {
          const withdrawal = await tx.withdrawal.findUnique({
            where: { id },
          });

          if (!withdrawal) {
            throw new NotFoundException('Retiro no encontrado');
          }

          if (withdrawal.status !== 'APPROVED') {
            throw new BadRequestException(
              'Solo puedes completar retiros que están en estado APPROVED',
            );
          }

          withdrawalUserId = withdrawal.userId;

          return tx.withdrawal.update({
            where: { id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: any) {
      if (error.code === 'P2034') {
        throw new BadRequestException(
          'Este retiro fue modificado por otro operador. Reintentá.',
        );
      }
      throw error;
    }

    this.logger.log(`Withdrawal ${id} marked as completed by operator ${operatorId}`);

    // Emit events after commit (Fix 45)
    this.events.emitToUser(withdrawalUserId!, 'withdrawal:completed', {
      withdrawalId: id,
      timestamp: new Date().toISOString(),
    });
    this.events.emitToOperators('withdrawal:completed', {
      withdrawalId: id,
      userId: withdrawalUserId!,
      operatorId,
      timestamp: new Date().toISOString(),
    });
    this.events.emitDashboardUpdate();

    return updated;
  }

  // Operator views
  async findPending() {
    return this.prisma.withdrawal.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: {
        user: { select: { id: true, username: true, email: true, balance: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAll(status?: string) {
    return this.prisma.withdrawal.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
