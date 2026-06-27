import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_SIZE_LIMIT_BYTES } from '../common/constants/timeouts';

export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  hash: string;
  userId: string;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  createdAt: Date;
}

export interface SignedUploadParams {
  signature: string;
  timestamp: number;
  cloudName: string;
  apiKey: string;
  folder: string;
  publicId: string;
  resourceType: string;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly maxFileSize = FILE_SIZE_LIMIT_BYTES;
  private readonly allowedMimeTypes = ['application/pdf'];

  // Cloudinary credentials parsed from CLOUDINARY_URL
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;

  // In-memory metadata map — only used for server-side uploads (bot screenshots, operator chat images)
  private files: Map<string, UploadedFile> = new Map();

  constructor(private readonly prisma: PrismaService) {
    // Cloudinary auto-configures from CLOUDINARY_URL env var
    cloudinary.config({ secure: true });

    // Parse CLOUDINARY_URL to extract credentials for signed uploads
    // Format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
    const cloudinaryUrl = (process.env.CLOUDINARY_URL || '').trim();
    const match = cloudinaryUrl.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (match) {
      this.apiKey = match[1];
      this.apiSecret = match[2];
      this.cloudName = match[3];
      this.logger.log(`Cloudinary configured: cloud=${this.cloudName}`);
    } else {
      this.logger.warn(
        'CLOUDINARY_URL not found or invalid — signed uploads will not work',
      );
      this.apiKey = '';
      this.apiSecret = '';
      this.cloudName = '';
    }
  }

  /**
   * Generate signed upload params for direct client-to-Cloudinary upload.
   * Validates auth, file metadata, and checks for duplicate proofs BEFORE the upload happens.
   */
  async generateSignedUploadParams(
    userId: string,
    requestId: string,
    fileHash: string,
    fileSize: number,
    mimeType: string,
  ): Promise<SignedUploadParams> {
    if (!this.apiSecret) {
      throw new BadRequestException(
        'Cloudinary not configured for signed uploads',
      );
    }

    // Validate file size
    if (!fileSize || fileSize <= 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (fileSize > this.maxFileSize) {
      throw new BadRequestException('El archivo excede el limite de 10MB');
    }

    // Validate MIME type
    if (
      !mimeType.startsWith('image/') &&
      !this.allowedMimeTypes.includes(mimeType)
    ) {
      throw new BadRequestException(
        `Tipo de archivo no permitido: ${mimeType}. Permitidos: imagenes y PDF`,
      );
    }

    // Verify the request exists, belongs to the user, and is in PENDING_PROOF status
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, userId: true },
    });

    if (!request) {
      throw new NotFoundException('Solicitud no encontrada');
    }
    if (request.userId !== userId) {
      throw new ForbiddenException('No tenes acceso a esta solicitud');
    }
    if (request.status !== 'PENDING_PROOF') {
      throw new BadRequestException('Esta solicitud ya tiene un comprobante');
    }

    // Check for duplicate proof hash in Prisma (replaces in-memory findByHash)
    if (fileHash) {
      const duplicate = await this.prisma.request.findFirst({
        where: {
          proofHash: fileHash,
          id: { not: requestId },
          userId: { not: userId },
          status: {
            notIn: ['VALIDATION_FAILED', 'FAILED', 'REJECTED'],
          },
        },
        select: { id: true },
      });

      if (duplicate) {
        this.logger.warn(
          `Duplicate proof detected at sign time: hash=${fileHash.slice(0, 16)}... original_request=${duplicate.id}`,
        );
        throw new BadRequestException(
          'Este comprobante ya fue utilizado en otra solicitud. Por favor, subi un comprobante diferente.',
        );
      }
    }

    // Generate signed upload params
    const timestamp = Math.round(Date.now() / 1000);
    const publicId = uuidv4();
    const folder = 'proofs';
    // Always upload as 'image' — Cloudinary accepts PDFs as multi-page image assets.
    // Uploading as 'raw' triggered Cloudinary's "Restricted media types" 401 on delivery
    // because PDF/ZIP raw delivery is disabled by default. As 'image' + transformation
    // (f_jpg,pg_1 at delivery time via toDeliverableUrl) Cloudinary returns a JPG of the
    // first page, which is never blocked by that setting.
    const resourceType = 'image';

    // resource_type goes in the URL, NOT in signed params — including it causes signature mismatch (401)
    const paramsToSign: Record<string, any> = {
      timestamp,
      folder,
      public_id: publicId,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      this.apiSecret,
    );

    this.logger.log(
      `Signed upload generated for request=${requestId}, publicId=${publicId}, resourceType=${resourceType}`,
    );

    return {
      signature,
      timestamp,
      cloudName: this.cloudName,
      apiKey: this.apiKey,
      folder,
      publicId,
      resourceType,
    };
  }

  /**
   * Server-side upload — used for bot screenshots and operator chat images.
   * NOT used for user proof uploads (those go direct to Cloudinary).
   */
  async uploadFile(
    file: Express.Multer.File,
    userId: string,
  ): Promise<UploadedFile> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!file.size || file.size <= 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (file.size > this.maxFileSize) {
      throw new BadRequestException('File size exceeds 10MB limit');
    }

    if (
      !file.mimetype.startsWith('image/') &&
      !this.allowedMimeTypes.includes(file.mimetype)
    ) {
      throw new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed: images and PDF`,
      );
    }

    this.logger.log(
      `Uploading file: type=${file.mimetype}, size=${file.size}, name=${file.originalname}`,
    );

    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const id = uuidv4();

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      // Always 'image' — see comment in generateSignedUploadParams. Cloudinary
      // accepts PDFs as multi-page image assets and we apply f_jpg,pg_1 in delivery.
      const resourceType = 'image';
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'proofs',
          public_id: id,
          resource_type: resourceType,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result!);
        },
      );
      stream.end(file.buffer);
    });

    const uploadedFile: UploadedFile = {
      id,
      filename: `${id}.${file.mimetype.split('/').pop()}`,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      hash,
      userId,
      cloudinaryUrl: result.secure_url,
      cloudinaryPublicId: result.public_id,
      createdAt: new Date(),
    };

    this.files.set(id, uploadedFile);
    this.logger.log(
      `File uploaded to Cloudinary: ${result.secure_url} (id: ${id})`,
    );

    return uploadedFile;
  }

  /**
   * Get file metadata from in-memory map (server-side uploads only)
   */
  async getFile(idOrUrl: string): Promise<UploadedFile> {
    const id = this.extractId(idOrUrl);
    const file = this.files.get(id);
    if (!file) {
      throw new NotFoundException('File not found');
    }
    return file;
  }

  /**
   * Get file with authorization check (server-side uploads only)
   */
  async getFileWithAuth(
    idOrUrl: string,
    userId: string,
    userRole: string,
  ): Promise<UploadedFile> {
    const file = await this.getFile(idOrUrl);
    const isOperator = ['OPERATOR', 'SENIOR_OPERATOR', 'ADMIN'].includes(
      userRole,
    );
    if (!isOperator && file.userId && file.userId !== userId) {
      throw new ForbiddenException('You do not have access to this file');
    }
    return file;
  }

  /**
   * Download file buffer from a URL (Cloudinary or any HTTP URL).
   * Used by validator flow to fetch proof images.
   */
  async getFileBuffer(url: string): Promise<Buffer> {
    if (!url.startsWith('http')) {
      throw new BadRequestException('Expected a full URL for file download');
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new NotFoundException(
        `Failed to download file from URL: HTTP ${response.status}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Delete a file from Cloudinary
   */
  async deleteFile(id: string): Promise<void> {
    const file = this.files.get(id);
    if (file) {
      try {
        const resourceType =
          file.mimeType === 'application/pdf' ? 'raw' : 'image';
        await cloudinary.uploader.destroy(file.cloudinaryPublicId, {
          resource_type: resourceType,
        });
      } catch (err) {
        this.logger.warn(`Failed to delete from Cloudinary: ${err.message}`);
      }
    }
    this.files.delete(id);
  }

  /**
   * Delete a file from Cloudinary by its public ID directly
   */
  async deleteByPublicId(
    publicId: string,
    resourceType: 'image' | 'raw' = 'image',
  ): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
      });
    } catch (err) {
      this.logger.warn(`Failed to delete from Cloudinary: ${err.message}`);
    }
  }

  private extractId(idOrUrl: string): string {
    if (!idOrUrl) return idOrUrl;
    if (idOrUrl.startsWith('http')) {
      const parts = idOrUrl.split('/');
      const last = parts[parts.length - 1];
      return last.split('.')[0];
    }
    if (idOrUrl.startsWith('/uploads/')) {
      return idOrUrl.split('/').pop() || idOrUrl;
    }
    return idOrUrl;
  }

  /**
   * Normalize a Cloudinary URL so PDFs are delivered as a JPG of the first page.
   * Cloudinary's "Restricted media types" setting blocks delivery of raw PDFs (returns 401),
   * but allows transformation results. Inserting `f_jpg,pg_1` after `/upload/` makes
   * Cloudinary render the PDF's first page as JPEG, which always succeeds.
   *
   * Idempotent: if the URL already contains the transformation, it's returned unchanged.
   * For non-PDF URLs or non-Cloudinary URLs, returns the input as-is.
   */
  toDeliverableUrl(url: string, mimeType?: string): string {
    if (!url || typeof url !== 'string') return url;
    if (!url.includes('res.cloudinary.com')) return url;

    const isPdf =
      mimeType === 'application/pdf' ||
      url.toLowerCase().endsWith('.pdf') ||
      url.includes('/raw/upload/');
    if (!isPdf) return url;

    if (url.includes('/f_jpg,pg_1/') || url.includes('/pg_1,f_jpg/')) {
      return url;
    }

    // Legacy assets uploaded with resource_type='raw' need both the resource_type swap
    // AND the transformation; assets uploaded as 'image' just need the transformation.
    let out = url.replace('/raw/upload/', '/image/upload/');
    out = out.replace('/image/upload/', '/image/upload/f_jpg,pg_1/');
    return out;
  }
}
