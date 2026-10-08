import { Module } from '@nestjs/common';
import { CvTextExtractor } from './cv-text-extractor.js';

@Module({
  providers: [CvTextExtractor],
  exports: [CvTextExtractor],
})
export class CvModule {}
