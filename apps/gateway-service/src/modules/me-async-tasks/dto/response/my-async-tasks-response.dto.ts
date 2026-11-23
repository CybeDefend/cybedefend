import { ApiProperty } from '@nestjs/swagger';
import { AsyncTaskDto } from './async-task.dto';

export class MyAsyncTasksResponseDto {
  @ApiProperty({
    type: [AsyncTaskDto],
    description: 'Async tasks owned by the authenticated user',
  })
  tasks: AsyncTaskDto[];
}
