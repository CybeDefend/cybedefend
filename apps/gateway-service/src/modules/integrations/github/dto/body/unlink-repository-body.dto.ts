// src/github-service/body/unlink-repository-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty } from 'class-validator';
export class UnLinkRepositoryBodyDto {
  @ApiProperty({ description: 'Repository identifier', example: 'uuid-value' })
  @IsUUID()
  @IsNotEmpty()
  repositoryId: string;
  constructor(repositoryId: string) {
    this.repositoryId = repositoryId;
  }
  public toString(): string {
    return JSON.stringify({ repositoryId: this.repositoryId });
  }
}
