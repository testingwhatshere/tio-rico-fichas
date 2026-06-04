export class UploadResponseDto {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  hash: string;
  createdAt: Date;
}
