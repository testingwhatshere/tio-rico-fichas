import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UploadsService, type SignedUploadParams } from './uploads.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { OperatorApiKeyGuard } from '../common/guards/operator-api-key.guard';
import { UploadResponseDto, SignUploadDto } from './dto';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Generate signed params for direct client-to-Cloudinary upload.
   * Client calls this first, then uploads directly to Cloudinary, then confirms via POST /requests/:id/proof.
   */
  @Post('sign-proof')
  async signProofUpload(
    @Body() dto: SignUploadDto,
    @CurrentUser() user: { sub: string },
  ): Promise<SignedUploadParams> {
    return this.uploadsService.generateSignedUploadParams(
      user.sub,
      dto.requestId,
      dto.fileHash,
      dto.fileSize,
      dto.mimeType,
    );
  }

  /**
   * Server-side proof upload (legacy — kept for backward compatibility).
   * New clients should use sign-proof + direct Cloudinary upload instead.
   */
  @Post('proof')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProof(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string },
  ): Promise<UploadResponseDto> {
    const uploaded = await this.uploadsService.uploadFile(file, user.sub);

    return {
      id: uploaded.id,
      filename: uploaded.filename,
      originalName: uploaded.originalName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      url: uploaded.cloudinaryUrl,
      hash: uploaded.hash,
      createdAt: uploaded.createdAt,
    };
  }

  @Post('chat-image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadChatImage(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { sub: string },
  ): Promise<{ url: string }> {
    const uploaded = await this.uploadsService.uploadFile(file, user.sub);
    return { url: uploaded.cloudinaryUrl };
  }

  @Get(':id')
  async getFile(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string; role: string },
    @Res() res: Response,
  ) {
    const file = await this.uploadsService.getFileWithAuth(id, user.sub, user.role);
    res.redirect(file.cloudinaryUrl);
  }

  @Post('operator/chat-image')
  @Public()
  @UseGuards(OperatorApiKeyGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadChatImageForOperator(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    const uploaded = await this.uploadsService.uploadFile(file, 'operator');
    return { url: uploaded.cloudinaryUrl };
  }

  @Get('operator/:id')
  @Public()
  @UseGuards(OperatorApiKeyGuard)
  async getFileForOperator(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.uploadsService.getFile(id);
    res.redirect(file.cloudinaryUrl);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async deleteFile(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.uploadsService.deleteFile(id);
    return { success: true };
  }
}
