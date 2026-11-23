import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AppService } from './app.service';
import { VersionResponseDto } from './dto/version-response.dto';

@ApiTags('Version')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Get API version and commit hash' })
  @ApiResponse({
    status: 200,
    description:
      'Returns the current API version, git commit hash, and environment',
    type: VersionResponseDto,
  })
  async getHello(): Promise<VersionResponseDto> {
    return this.appService.getHello();
  }

  // GET /client-apps belongs to the cloud edition.

  /**
   * Public and unguarded: crawlers ask for it without a token. The API has
   * nothing to index, and a 404 here reads as "crawl everything": a crawler
   * would then walk every path of the public OpenAPI reference without a
   * token, each one an auth rejection.
   */
  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiExcludeEndpoint()
  getRobotsTxt(): string {
    return 'User-agent: *\nDisallow: /\n';
  }
}
