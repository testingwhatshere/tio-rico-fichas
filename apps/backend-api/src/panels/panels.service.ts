import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePanelDto } from './dto/create-panel.dto';
import { UpdatePanelDto } from './dto/update-panel.dto';

@Injectable()
export class PanelsService {
  private readonly logger = new Logger(PanelsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePanelDto) {
    try {
      const panel = await this.prisma.panel.create({
        data: { name: dto.name },
      });
      this.logger.log(`Panel created: ${panel.id} (${panel.name})`);
      return panel;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          `Panel with name "${dto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async findAll() {
    return this.prisma.panel.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { users: true, jobs: true },
        },
      },
    });
  }

  async findActive() {
    return this.prisma.panel.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const panel = await this.prisma.panel.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, jobs: true },
        },
      },
    });
    if (!panel) throw new NotFoundException('Panel not found');
    return panel;
  }

  async update(id: string, dto: UpdatePanelDto) {
    await this.findOne(id);
    try {
      const panel = await this.prisma.panel.update({
        where: { id },
        data: dto,
      });
      this.logger.log(`Panel updated: ${panel.id} (${panel.name})`);
      return panel;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          `Panel with name "${dto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    // Deactivate instead of hard delete to preserve historical data
    const panel = await this.prisma.panel.update({
      where: { id },
      data: { isActive: false },
    });
    this.logger.log(`Panel deactivated: ${panel.id} (${panel.name})`);
    return panel;
  }

  async validatePanelId(panelId: string): Promise<boolean> {
    const panel = await this.prisma.panel.findUnique({
      where: { id: panelId },
      select: { id: true, isActive: true },
    });
    return !!panel?.isActive;
  }
}
