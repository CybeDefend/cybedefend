import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SearchDockerImagesQueryDto {
  @ApiProperty({
    description:
      'Search query for Docker Hub images (e.g., "python", "nginx", "bitnami/nginx")',
    required: false,
    type: String,
    example: 'python',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  query?: string;
}
