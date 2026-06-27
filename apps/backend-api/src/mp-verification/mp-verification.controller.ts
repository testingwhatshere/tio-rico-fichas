import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Headers,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BotApiKeyGuard } from '../bot/guards/bot-api-key.guard';
import { Public } from '../common/decorators/public.decorator';
import { MpVerificationService } from './mp-verification.service';
import { PaymentsService } from '../payments/payments.service';
import {
  MpVerificationConfirmDto,
  MpUnmatchedTransferDto,
} from './dto/mp-verification.dto';

@Controller('mp-verification')
@Public() // Exempt from JWT auth - uses API key instead
@UseGuards(BotApiKeyGuard)
export class MpVerificationController {
  constructor(
    private readonly mpVerificationService: MpVerificationService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get('pending')
  async getPending(@Query('walletId') walletId: string) {
    if (!walletId) {
      throw new BadRequestException('walletId is required');
    }
    return this.mpVerificationService.getPendingForWallet(walletId);
  }

  @Post('confirm')
  async confirm(
    @Body() dto: MpVerificationConfirmDto,
    @Headers('x-wallet-id') walletId: string,
  ) {
    if (!walletId) {
      throw new BadRequestException('x-wallet-id header is required');
    }
    return this.mpVerificationService.confirmVerification(dto, walletId);
  }

  @Post('unmatched')
  async reportUnmatched(
    @Body() dto: MpUnmatchedTransferDto,
    @Headers('x-wallet-id') walletId: string,
  ) {
    if (!walletId) {
      throw new BadRequestException('x-wallet-id header is required');
    }
    return this.mpVerificationService.reportUnmatched(dto, walletId);
  }

  @Post('heartbeat')
  async heartbeat(@Headers('x-wallet-id') walletId: string) {
    if (!walletId) {
      throw new BadRequestException('x-wallet-id header is required');
    }
    return this.mpVerificationService.heartbeat(walletId);
  }

  @Post('session-expired')
  async reportSessionExpired(
    @Headers('x-wallet-id') walletId: string,
    @Body() body: { walletLabel?: string },
  ) {
    return this.mpVerificationService.handleSessionExpired(
      walletId,
      body?.walletLabel,
    );
  }

  @Post('balance')
  async reportBalance(
    @Headers('x-wallet-id') walletId: string,
    @Body() body: { balance: number },
  ) {
    if (!walletId) {
      throw new BadRequestException('x-wallet-id header is required');
    }
    return this.mpVerificationService.updateWalletBalance(
      walletId,
      body.balance,
    );
  }

  @Post('transfers')
  async reportTransfers(
    @Headers('x-wallet-id') walletId: string,
    @Body() body: { transfers: any[] },
  ) {
    return this.mpVerificationService.reportIncomingTransfers(
      walletId,
      body.transfers,
    );
  }

  @Post('screenshot')
  @UseInterceptors(FileInterceptor('screenshot'))
  async uploadScreenshot(
    @UploadedFile() file: Express.Multer.File,
    @Body('requestId') requestId: string,
  ) {
    if (!file || !requestId) {
      throw new BadRequestException(
        'screenshot file and requestId are required',
      );
    }
    const url = await this.mpVerificationService.saveVerificationScreenshot(
      requestId,
      file.buffer,
    );
    return { url };
  }

  @Post('auto-detect-wallet')
  async autoDetectWallet(@Body() body: { accountName: string }) {
    if (!body.accountName) {
      throw new BadRequestException('accountName is required');
    }
    return this.mpVerificationService.autoDetectWallet(body.accountName);
  }

  @Get('wallets')
  async getWallets() {
    return this.paymentsService.getAllWallets();
  }

  @Get('stats')
  async getStats(@Query('walletId') walletId: string) {
    if (!walletId) {
      throw new BadRequestException('walletId is required');
    }
    return this.mpVerificationService.getStats(walletId);
  }
}
