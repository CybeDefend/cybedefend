import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Redis from 'ioredis';

/** A task id is a ULID or a UUID: anything else names no task. */
const TASK_ID_PATTERN =
  /^(?:[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

@Injectable()
export class AsyncTaskOwnerGuard implements CanActivate {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const taskId: unknown = req.params?.taskId;
    // Checked before it is put in a Redis key.
    if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
      throw new BadRequestException('Invalid task id');
    }

    const raw = await this.redis.get(`cybe:asynctask:${taskId}`);
    if (!raw) {
      throw new NotFoundException('Async task not found');
    }

    const record = JSON.parse(raw) as { userId: string };
    if (record.userId !== req.user.sub) {
      throw new ForbiddenException('Not the owner of this task');
    }

    return true;
  }
}
