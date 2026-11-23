import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SetChannelBodyDto {
  @ApiProperty({
    description: 'Slack channel ID',
    example: 'C0123456789',
  })
  @IsString()
  @IsNotEmpty()
  channelId: string;

  @ApiProperty({
    description: 'Slack channel name',
    example: '#security-alerts',
  })
  @IsString()
  @IsNotEmpty()
  channelName: string;

  constructor(channelId: string, channelName: string) {
    this.channelId = channelId;
    this.channelName = channelName;
  }

  public toString(): string {
    return JSON.stringify({
      channelId: this.channelId,
      channelName: this.channelName,
    });
  }
}
