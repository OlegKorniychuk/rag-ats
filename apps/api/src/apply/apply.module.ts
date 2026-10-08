import { Module } from '@nestjs/common';
import { CvModule } from '../cv/cv.module.js';
import { ApplyController } from './apply.controller.js';
import { ApplyService } from './apply.service.js';

@Module({
  imports: [CvModule],
  controllers: [ApplyController],
  providers: [ApplyService],
})
export class ApplyModule {}
