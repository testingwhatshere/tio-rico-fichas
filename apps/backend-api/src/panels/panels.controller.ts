import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PanelsService } from './panels.service';
import { CreatePanelDto } from './dto/create-panel.dto';
import { UpdatePanelDto } from './dto/update-panel.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('panels')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PanelsController {
  constructor(private readonly panelsService: PanelsService) {}

  @Get()
  @Roles('ADMIN', 'SENIOR_OPERATOR', 'OPERATOR')
  findAll() {
    return this.panelsService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'SENIOR_OPERATOR', 'OPERATOR')
  findOne(@Param('id') id: string) {
    return this.panelsService.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'SENIOR_OPERATOR', 'OPERATOR')
  create(@Body() dto: CreatePanelDto) {
    return this.panelsService.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SENIOR_OPERATOR', 'OPERATOR')
  update(@Param('id') id: string, @Body() dto: UpdatePanelDto) {
    return this.panelsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.panelsService.remove(id);
  }
}
