import { Module } from '@nitrostack/core';
import { ReviewTools } from './review.tools.js';
import { ReviewService } from './review.service.js';
import { ReviewResources } from './review.resources.js';

@Module({ name: 'review', controllers: [ReviewTools, ReviewResources], providers: [ReviewService] })
export class ReviewModule {}
