import { McpApp, Module, ConfigModule } from '@nitrostack/core';
import { ReviewModule } from './review/review.module.js';

@McpApp({
  module: AppModule,
  server: { name: 'pr-archaeologist', version: '1.0.0' },
  logging: { level: 'warn' }
})
@Module({ name: 'app', imports: [ConfigModule.forRoot(), ReviewModule] })
export class AppModule {}
