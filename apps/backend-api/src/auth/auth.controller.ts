import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, AuthResponseDto, ClientAuthDto } from './dto';
import type { CurrentUserPayload } from './interfaces/current-user.interface';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Simple client authentication - username only (no password)
   * Creates user if doesn't exist, returns token if exists
   * This is the primary auth method for the chat app
   */
  @Public()
  @Post('client')
  @HttpCode(HttpStatus.OK)
  async clientAuth(@Body() dto: ClientAuthDto): Promise<AuthResponseDto> {
    return this.authService.clientAuth(dto);
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Get('me')
  async me(@CurrentUser() user: CurrentUserPayload): Promise<CurrentUserPayload> {
    return user;
  }
}
