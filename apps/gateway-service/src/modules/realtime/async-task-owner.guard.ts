import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class AsyncTaskOwnerGuard implements CanActivate {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const taskId: string = req.params.taskId;

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
