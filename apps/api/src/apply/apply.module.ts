import { Module } from '@nestjs/common';
import { CvModule } from '../cv/cv.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { ApplyController } from './apply.controller.js';
import { ApplyService } from './apply.service.js';

@Module({
  imports: [CvModule, JobsModule],
  controllers: [ApplyController],
  providers: [ApplyService],
})
export class ApplyModule {}
