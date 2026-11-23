import { Controller, Get } from '@nestjs/common';

import { Public } from '../core/guards/auth/public.decorator';

@Public()
@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'mcp-service',
      uptime: process.uptime(),
    };
  }
}
