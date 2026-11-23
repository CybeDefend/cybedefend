import { Controller, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { MeAsyncTasksService } from './me-async-tasks.service';
import { MyAsyncTasksResponseDto } from './dto/response/my-async-tasks-response.dto';

@ApiTags('Me — Async Tasks')
@ApiBearerAuth()
@UseGuards(CombinedAuthRateLimitGuard)
@Controller('me/async-tasks')
export class MeAsyncTasksController {
  constructor(private readonly service: MeAsyncTasksService) {}

  @Get()
  @ApiOperation({
    summary:
      'List all async tasks owned by the authenticated user (for tracker rehydration after page reload).',
  })
  @ApiResponse({ status: 200, type: MyAsyncTasksResponseDto })
  async listAsyncTasks(@Req() req: any): Promise<MyAsyncTasksResponseDto> {
    const tasks = await this.service.listAsyncTasks(req.user.sub);
    return { tasks };
  }

  @Delete(':taskId')
  @ApiOperation({
    summary:
      "Dismiss (persistently delete) one of the authenticated user's async tasks so it does not reappear after a reload.",
  })
  @ApiResponse({ status: 200 })
  async deleteAsyncTask(
    @Req() req: any,
    @Param('taskId') taskId: string,
  ): Promise<{ success: true }> {
    await this.service.deleteAsyncTask(req.user.sub, taskId);
    return { success: true };
  }
}
