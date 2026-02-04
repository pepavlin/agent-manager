import { z } from 'zod';
import { ToolDefinition, RiskLevel } from '../types/index.js';

// Tool argument schemas
export const BacklogAddItemArgsSchema = z.object({
  title: z.string().min(1).describe('Title of the backlog item'),
  description: z.string().describe('Detailed description of the item'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium').describe('Priority level'),
});

export const IssueCreateArgsSchema = z.object({
  title: z.string().min(1).describe('Issue title'),
  body: z.string().describe('Issue body/description'),
  labels: z.array(z.string()).default([]).describe('Labels to apply'),
});

export const DocsRequestMoreArgsSchema = z.object({
  topic: z.string().describe('What topic/area needs more documentation'),
  reason: z.string().describe('Why this documentation is needed'),
});

export const ReminderScheduleArgsSchema = z.object({
  message: z.string().describe('Reminder message'),
  when: z.string().describe('When to send reminder (ISO date or relative like "in 1 hour")'),
});

// Tool definitions
export const TOOLS: Record<string, ToolDefinition> = {
  'backlog.add_item': {
    name: 'backlog.add_item',
    description: 'Add a new item to the project backlog',
    argsSchema: BacklogAddItemArgsSchema,
    requiresApproval: true,
    defaultRisk: 'low' as RiskLevel,
  },
  'issue.create': {
    name: 'issue.create',
    description: 'Create a new issue in the issue tracker',
    argsSchema: IssueCreateArgsSchema,
    requiresApproval: true,
    defaultRisk: 'medium' as RiskLevel,
  },
  'docs.request_more': {
    name: 'docs.request_more',
    description: 'Request more documentation from the user on a specific topic',
    argsSchema: DocsRequestMoreArgsSchema,
    requiresApproval: false,
    defaultRisk: 'low' as RiskLevel,
  },
  'reminder.schedule': {
    name: 'reminder.schedule',
    description: 'Schedule a reminder for the user',
    argsSchema: ReminderScheduleArgsSchema,
    requiresApproval: false,
    defaultRisk: 'low' as RiskLevel,
  },
};
