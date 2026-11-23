import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppModule } from './app.module';

@Module({
  imports: [AppModule, ScheduleModule.forRoot()],
})
export class CronAppModule {}
