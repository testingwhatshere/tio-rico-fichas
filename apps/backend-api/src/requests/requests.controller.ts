import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequestsService } from './requests.service';
import { UploadsService } from '../uploads/uploads.service';
import { FILE_SIZE_LIMIT_BYTES } from '../common/constants/timeouts';
import { MessagesService } from '../messages/messages.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateRequestDto, ApproveRequestDto, RejectRequestDto } from './dto';
import { ConfirmProofUploadDto } from '../uploads/dto';

@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly uploadsService: UploadsService,
    private readonly messagesService: MessagesService,
  ) {}

  // ==========================================
  // STATIC ROUTES FIRST (before :id params)
  // ==========================================

  @Post()
  async create(
    @CurrentUser() user: { sub: string },
    @Body() dto: CreateRequestDto,
  ) {
    return this.requestsService.create(user.sub, dto);
  }

  @Get()
  async findMine(@CurrentUser() user: { sub: string }) {
    return this.requestsService.findAllByUser(user.sub);
  }

  /**
   * Returns the user's currently in-progress load request, or — if none — the latest
   * terminal request within the last 6 hours so the home banner can show "Carga
   * completada / rechazada / validación fallida" right after the final status change.
   */
  @Get('me/active')
  async getMyActive(@CurrentUser() user: { sub: string }) {
    const current = await this.requestsService.findCurrentForUser(user.sub);
    return current || null;
  }

  // ==========================================
  // OPERATOR STATIC ROUTES (must come before :id)
  // ==========================================

  @Get('operator/pending')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findPending() {
    return this.requestsService.findPending();
  }

  @Get('operator/failed-validation')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async findFailedValidation() {
    return this.requestsService.findFailedValidation();
  }

  @Get('operator/all')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async findAll(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.requestsService.findAll({
      status: status as any,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('operator/stats')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getStats() {
    return this.requestsService.getStats();
  }

  @Get('operator/my-assignments')
  @Roles('OPERATOR', 'SENIOR_OPERATOR', 'ADMIN')
  async getMyAssignments(@CurrentUser() user: { sub: string }) {
    return this.requestsService.getAssignedToOperator(user.sub);
  }

  @Get('operator/unassigned-failures')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async getUnassignedFailures() {
    return this.requestsService.getUnassignedFailures();
  }

  // ==========================================
  // PARAMETERIZED ROUTES (must come LAST)
  // ==========================================

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    // Operators can view any request
    if (['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(user.role)) {
      return this.requestsService.findOne(id);
    }
    return this.requestsService.findOne(id, user.sub);
  }

  /**
   * Confirm a direct-to-Cloudinary proof upload.
   * Client uploads to Cloudinary first (using signed params from POST /uploads/sign-proof),
   * then calls this endpoint with the resulting URL to link it to the request.
   */
  @Post(':id/proof/confirm')
  async confirmProofUpload(
    @Param('id') id: string,
    @Body() dto: ConfirmProofUploadDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.requestsService.uploadProof(
      id,
      user.sub,
      dto.cloudinaryUrl,
      dto.fileHash,
    );
  }

  /**
   * Legacy server-side proof upload (multipart).
   * New clients should use POST /uploads/sign-proof + direct Cloudinary + POST :id/proof/confirm.
   */
  @Post(':id/proof')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: FILE_SIZE_LIMIT_BYTES,
      },
      fileFilter: (_req, file, cb) => {
        if (
          file.mimetype.startsWith('image/') ||
          file.mimetype === 'application/pdf'
        ) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Tipo de archivo no permitido: ${file.mimetype}. Permitidos: imágenes (PNG, JPG, HEIC, etc.) y PDF`,
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadProof(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string },
  ) {
    if (!file) {
      throw new BadRequestException('No se adjuntó ningún archivo');
    }

    const upload = await this.uploadsService.uploadFile(file, user.sub);
    return this.requestsService.uploadProof(
      id,
      user.sub,
      upload.cloudinaryUrl,
      upload.hash,
    );
  }

  @Post(':id/approve')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: ApproveRequestDto,
  ) {
    return this.requestsService.approve(id, user.sub, dto);
  }

  @Post(':id/reject')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async reject(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: RejectRequestDto,
  ) {
    return this.requestsService.reject(id, user.sub, dto);
  }

  @Post(':id/assign')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async assignOperator(
    @Param('id') id: string,
    @Body('operatorId') operatorId: string,
  ) {
    return this.requestsService.assignOperator(id, operatorId);
  }

  @Post(':id/unassign')
  @Roles('SENIOR_OPERATOR', 'ADMIN')
  async unassignOperator(@Param('id') id: string) {
    return this.requestsService.unassignOperator(id);
  }

  @Delete(':id')
  async cancel(@Param('id') id: string, @CurrentUser() user: { sub: string }) {
    return this.requestsService.cancel(id, user.sub);
  }

  // ==========================================
  // REQUEST-CONTEXTUAL MESSAGES
  // ==========================================

  /**
   * Get messages for a request's chat
   * Resolves the request's associated chat and returns messages
   */
  @Get(':id/messages')
  async getRequestMessages(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; role: string },
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const chatId = await this.requestsService.getOrCreateRequestChat(
      id,
      user.sub,
      user.role,
    );
    return this.messagesService.getMessages(chatId, user.sub, user.role, {
      limit: limit ? parseInt(limit) : undefined,
      cursor,
    });
  }

  /**
   * Send a message in a request's chat
   * Resolves the request's associated chat and sends the message
   */
  @Post(':id/messages')
  async sendRequestMessage(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; role: string },
    @Body('content') content: string,
  ) {
    const chatId = await this.requestsService.getOrCreateRequestChat(
      id,
      user.sub,
      user.role,
    );
    return this.messagesService.sendMessage(
      user.sub,
      { chatId, content },
      user.role,
    );
  }

  /**
   * Get status change timeline for a request
   * Returns chronological history of all status changes
   */
  @Get(':id/timeline')
  async getRequestTimeline(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
  ) {
    const timeline = await this.requestsService.getRequestTimeline(
      id,
      user.sub,
    );
    return { timeline };
  }
}
