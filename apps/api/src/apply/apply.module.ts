import { Module } from '@nestjs/common';
import { ApplyController } from './apply.controller.js';
import { ApplyService } from './apply.service.js';

@Module({
  controllers: [ApplyController],
  providers: [ApplyService],
})
export class ApplyModule {}
