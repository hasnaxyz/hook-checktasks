#!/usr/bin/env bun

/**
 * Claude Code Hook: check-tasks
 *
 * Prevents Claude from stopping when there are pending/in-progress tasks.
 *
 * Task list resolution:
 * 1. taskListId set in config (settings.json) -> use that specific list
 * 2. CLAUDE_CODE_TASK_LIST_ID env var -> auto-set by Claude Code per-session
 * 3. Neither exists -> allow stop (no task list to check)
 *
 * Config options:
 * - taskListId: specific list to check
 * - enabled: enable/disable the hook
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface Task {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
}

interface CheckTasksConfig {
  taskListId?: string;
  keywords?: string[];
  enabled?: boolean;
}

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  stop_hook_active: boolean;
}

const CONFIG_KEY = "checkTasksConfig";

function readStdinJson(): HookInput | null {
  try {
    const stdin = readFileSync(0, "utf-8");
    return JSON.parse(stdin);
  } catch {
    return null;
  }
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function getConfig(cwd: string): CheckTasksConfig {
  // Try project settings first
  const projectSettings = readSettings(join(cwd, ".claude", "settings.json"));
  if (projectSettings[CONFIG_KEY]) {
    return projectSettings[CONFIG_KEY] as CheckTasksConfig;
  }

  // Fall back to global settings
  const globalSettings = readSettings(join(homedir(), ".claude", "settings.json"));
  if (globalSettings[CONFIG_KEY]) {
    return globalSettings[CONFIG_KEY] as CheckTasksConfig;
  }

  // Legacy: use environment variables
  return {
    taskListId: process.env.CLAUDE_CODE_TASK_LIST_ID,
    enabled: process.env.CHECK_TASKS_DISABLED !== "1",
  };
}

function getTasksFromList(listId: string): Task[] {
  const tasksDir = join(homedir(), ".claude", "tasks", listId);
  if (!existsSync(tasksDir)) return [];

  try {
    const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".json"));
    return taskFiles.map((file) => {
      const content = readFileSync(join(tasksDir, file), "utf-8");
      return JSON.parse(content) as Task;
    });
  } catch {
    return [];
  }
}

function approve() {
  console.log(JSON.stringify({ decision: "approve" }));
  process.exit(0);
}

function block(reason: string) {
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

export function run() {
  const hookInput = readStdinJson();
  const cwd = hookInput?.cwd || process.cwd();

  const config = getConfig(cwd);

  // Check if hook is disabled
  if (config.enabled === false) {
    approve();
  }

  // Determine which task list to check: config > env var > nothing
  let taskListId: string | undefined;

  if (config.taskListId) {
    taskListId = config.taskListId;
  } else if (process.env.CLAUDE_CODE_TASK_LIST_ID) {
    taskListId = process.env.CLAUDE_CODE_TASK_LIST_ID;
  }

  if (!taskListId) {
    // No task list configured or detected, allow stop
    approve();
    return;
  }

  // Get tasks from the resolved list
  const tasks = getTasksFromList(taskListId);
  const pending = tasks.filter((t) => t.status === "pending");
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const completed = tasks.filter((t) => t.status === "completed");

  const remainingCount = pending.length + inProgress.length;

  if (remainingCount > 0) {
    const nextTasks = pending
      .slice(0, 3)
      .map((t) => `- ${t.subject}`)
      .join("\n");

    const prompt = `
STOP BLOCKED: You have ${remainingCount} tasks remaining in "${taskListId}" (${pending.length} pending, ${inProgress.length} in progress, ${completed.length} completed).

DO NOT STOP. DO NOT ASK QUESTIONS. DO NOT WAIT FOR USER INPUT.

You MUST continue working AUTONOMOUSLY until ALL tasks are completed.

Next pending tasks:
${nextTasks}
${pending.length > 3 ? `... and ${pending.length - 3} more pending tasks` : ""}

MANDATORY INSTRUCTIONS (follow these NOW):
1. Use TaskList to see all tasks
2. Use TaskGet to read the FIRST pending task's full description
3. Use TaskUpdate to mark it as in_progress BEFORE starting work
4. Complete the task (write code, run commands, etc.)
5. Use TaskUpdate to mark it as completed AFTER finishing
6. IMMEDIATELY move to the next task - DO NOT STOP

CRITICAL RULES:
- NEVER ask "would you like me to..." - just DO IT
- NEVER ask for confirmation - just WORK
- NEVER stop to explain what you'll do - just DO IT
- If a task is unclear, make reasonable assumptions and proceed
- If you encounter an error, fix it and continue
- Keep working until remainingCount = 0

START WORKING NOW. Use TaskList tool in your next response.
`.trim();

    block(prompt);
  }

  // All tasks completed, allow stop
  approve();
}

// Allow direct execution
if (import.meta.main) {
  run();
}
