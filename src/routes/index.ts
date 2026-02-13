import { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { projectRoutes } from './projects.js';
import { chatRoutes } from './chat.js';
import { toolRoutes } from './tools.js';
import { maintenanceRoutes } from './maintenance.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(projectRoutes);
  await app.register(chatRoutes);
  await app.register(toolRoutes);
  await app.register(maintenanceRoutes);
}
