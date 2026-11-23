import { IsUUID, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for unlinking GitLab repository from project
 */
export class UnlinkGitlabRepositoryDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'GitLab repository identifier to unlink',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  repositoryId: string;
}
