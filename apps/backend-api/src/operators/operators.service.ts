import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import {
  CreateOperatorDto,
  UpdateOperatorDto,
  OperatorResponseDto,
  OperatorStatsDto,
} from './dto';

@Injectable()
export class OperatorsService {
  private readonly logger = new Logger(OperatorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * Create a new operator profile
   */
  async createOperator(dto: CreateOperatorDto): Promise<OperatorResponseDto> {
    // Check if user exists and has appropriate role
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(user.role)) {
      throw new BadRequestException('User must have an operator role');
    }

    // Check if operator profile already exists
    const existing = await this.prisma.operator.findUnique({
      where: { userId: dto.userId },
    });

    if (existing) {
      throw new ConflictException('Operator profile already exists for this user');
    }

    const operator = await this.prisma.operator.create({
      data: {
        userId: dto.userId,
        displayName: dto.displayName,
        maxChats: dto.maxChats || 5,
      },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    this.logger.log(`Created operator profile for user ${dto.userId}`);

    return this.formatOperator(operator);
  }

  /**
   * Get all operators
   */
  async getAllOperators(): Promise<OperatorResponseDto[]> {
    const operators = await this.prisma.operator.findMany({
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Get active chat counts
    const operatorsWithCounts = await Promise.all(
      operators.map(async (op) => {
        const activeChats = await this.prisma.chat.count({
          where: {
            operatorId: op.userId,
            status: 'ASSIGNED',
          },
        });
        return { ...op, activeChats };
      }),
    );

    return operatorsWithCounts.map((op) => this.formatOperator(op));
  }

  /**
   * Get available operators (for chat assignment)
   */
  async getAvailableOperators(): Promise<OperatorResponseDto[]> {
    const operators = await this.prisma.operator.findMany({
      where: { isAvailable: true },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    // Filter by capacity
    const availableOperators = await Promise.all(
      operators.map(async (op) => {
        const activeChats = await this.prisma.chat.count({
          where: {
            operatorId: op.userId,
            status: 'ASSIGNED',
          },
        });

        if (activeChats < op.maxChats) {
          return { ...op, activeChats };
        }
        return null;
      }),
    );

    return availableOperators
      .filter((op) => op !== null)
      .map((op) => this.formatOperator(op!));
  }

  /**
   * Get operator by ID
   */
  async getOperatorById(id: string): Promise<OperatorResponseDto> {
    const operator = await this.prisma.operator.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    if (!operator) {
      throw new NotFoundException('Operator not found');
    }

    const activeChats = await this.prisma.chat.count({
      where: {
        operatorId: operator.userId,
        status: 'ASSIGNED',
      },
    });

    return this.formatOperator({ ...operator, activeChats });
  }

  /**
   * Get operator by user ID
   */
  async getOperatorByUserId(userId: string): Promise<OperatorResponseDto> {
    const operator = await this.prisma.operator.findUnique({
      where: { userId },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    if (!operator) {
      throw new NotFoundException('Operator profile not found');
    }

    const activeChats = await this.prisma.chat.count({
      where: {
        operatorId: userId,
        status: 'ASSIGNED',
      },
    });

    return this.formatOperator({ ...operator, activeChats });
  }

  /**
   * Update operator profile
   */
  async updateOperator(
    id: string,
    dto: UpdateOperatorDto,
  ): Promise<OperatorResponseDto> {
    const operator = await this.prisma.operator.findUnique({
      where: { id },
    });

    if (!operator) {
      throw new NotFoundException('Operator not found');
    }

    const updated = await this.prisma.operator.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        isAvailable: dto.isAvailable,
        maxChats: dto.maxChats,
      },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    this.logger.log(`Updated operator ${id}`);

    // Notify about availability change
    if (dto.isAvailable !== undefined) {
      this.eventsGateway.emitToOperators('operator:availability_changed', {
        operatorId: id,
        isAvailable: dto.isAvailable,
      });
    }

    return this.formatOperator(updated);
  }

  /**
   * Set operator availability
   */
  async setAvailability(
    userId: string,
    isAvailable: boolean,
  ): Promise<OperatorResponseDto> {
    const operator = await this.prisma.operator.findUnique({
      where: { userId },
    });

    if (!operator) {
      throw new NotFoundException('Operator profile not found');
    }

    const updated = await this.prisma.operator.update({
      where: { userId },
      data: { isAvailable },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });

    this.logger.log(`Operator ${userId} availability set to ${isAvailable}`);

    this.eventsGateway.emitToOperators('operator:availability_changed', {
      operatorId: operator.id,
      userId,
      isAvailable,
    });

    return this.formatOperator(updated);
  }

  /**
   * Delete operator profile
   */
  async deleteOperator(id: string): Promise<{ success: boolean }> {
    const operator = await this.prisma.operator.findUnique({
      where: { id },
    });

    if (!operator) {
      throw new NotFoundException('Operator not found');
    }

    // Check for active chats
    const activeChats = await this.prisma.chat.count({
      where: {
        operatorId: operator.userId,
        status: 'ASSIGNED',
      },
    });

    if (activeChats > 0) {
      throw new BadRequestException(
        'Cannot delete operator with active chats. Reassign chats first.',
      );
    }

    await this.prisma.operator.delete({ where: { id } });

    this.logger.log(`Deleted operator ${id}`);

    return { success: true };
  }

  /**
   * Get operator statistics
   */
  async getOperatorStats(operatorId: string): Promise<OperatorStatsDto> {
    const operator = await this.prisma.operator.findUnique({
      where: { id: operatorId },
    });

    if (!operator) {
      throw new NotFoundException('Operator not found');
    }

    const [totalChats, activeChats, approved, rejected] = await Promise.all([
      this.prisma.chat.count({
        where: { operatorId: operator.userId },
      }),
      this.prisma.chat.count({
        where: {
          operatorId: operator.userId,
          status: 'ASSIGNED',
        },
      }),
      this.prisma.request.count({
        where: {
          approvedById: operator.userId,
          status: { in: ['APPROVED', 'PROCESSING', 'COMPLETED'] },
        },
      }),
      this.prisma.request.count({
        where: {
          approvedById: operator.userId,
          status: 'REJECTED',
        },
      }),
    ]);

    return {
      operatorId,
      displayName: operator.displayName,
      totalChatsHandled: totalChats,
      activeChats,
      requestsApproved: approved,
      requestsRejected: rejected,
    };
  }

  /**
   * Get all operators stats (for dashboard)
   */
  async getAllOperatorsStats(): Promise<OperatorStatsDto[]> {
    const operators = await this.prisma.operator.findMany();

    const stats = await Promise.all(
      operators.map((op) => this.getOperatorStats(op.id)),
    );

    return stats;
  }

  /**
   * Format operator for response
   */
  private formatOperator(operator: any): OperatorResponseDto {
    return {
      id: operator.id,
      userId: operator.userId,
      displayName: operator.displayName,
      isAvailable: operator.isAvailable,
      maxChats: operator.maxChats,
      createdAt: operator.createdAt,
      updatedAt: operator.updatedAt,
      user: operator.user,
      activeChats: operator.activeChats,
    };
  }
}
