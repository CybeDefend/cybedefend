import { IsString } from 'class-validator';

export class TeamAddMemberResponseDto {
  @IsString()
  readonly message: string;

  constructor(message: string) {
    this.message = message;
  }

  public toString(): string {
    return JSON.stringify({
      message: this.message,
    });
  }
}
