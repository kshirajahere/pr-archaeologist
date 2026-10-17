import { Module } from '@nitrostack/core';
import { ReviewTools } from './review.tools.js';
import { ReviewService } from './review.service.js';
import { ReviewResources } from './review.resources.js';
import { FollowupService } from './followup.service.js';
import { FollowupTools } from './followup.tools.js';

@Module({ name: 'review', controllers: [ReviewTools, ReviewResources, FollowupTools], providers: [ReviewService, FollowupService] })
export class ReviewModule {}
