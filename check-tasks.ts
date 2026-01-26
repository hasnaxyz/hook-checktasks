#!/usr/bin/env bun

/**
 * Claude Code Hook: check-tasks
 *
 * Prevents Claude from stopping when there are pending/in-progress tasks.
 * Only blocks stop for sessions with "dev" in the name (or task list ID).
 *
 * Configuration (environment variables):
 * - CLAUDE_CODE_TASK_LIST_ID: Task list to check (required for task checking)
 * - CHECK_TASKS_KEYWORDS: Comma-separated keywords to trigger check (default: "dev")
 * - CHECK_TASKS_DISABLED: Set to "1" to disable the hook
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface Task {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
}

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  stop_hook_active: boolean;
}

// Read hook input from stdin synchronously
function readStdinJson(): HookInput | null {
  try {
    const stdin = readFileSync(0, "utf-8");
    return JSON.parse(stdin);
  } catch {
    return null;
  }
}

// Get session name from transcript using grep-like search (fast, no full parse)
function getSessionName(transcriptPath: string): string | null {
  if (!existsSync(transcriptPath)) return null;

  try {
    const content = readFileSync(transcriptPath, "utf-8");

    // Find all custom-title entries and get the last one (most recent rename)
    let lastTitle: string | null = null;
    let searchStart = 0;

    while (true) {
      const titleIndex = content.indexOf('"custom-title"', searchStart);
      if (titleIndex === -1) break;

      // Find the line containing this match
      const lineStart = content.lastIndexOf("\n", titleIndex) + 1;
      const lineEnd = content.indexOf("\n", titleIndex);
      const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

      try {
        const entry = JSON.parse(line);
        if (entry.type === "custom-title" && entry.customTitle) {
          lastTitle = entry.customTitle;
        }
      } catch {
        // Skip malformed lines
      }

      searchStart = titleIndex + 1;
    }

    return lastTitle;
  } catch {
    return null;
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

function main() {
  // Check if hook is disabled
  if (process.env.CHECK_TASKS_DISABLED === "1") {
    approve();
  }

  const taskListId = process.env.CLAUDE_CODE_TASK_LIST_ID;

  if (!taskListId) {
    // No task list configured, allow stop
    approve();
  }

  // Read hook input to get transcript path
  const hookInput = readStdinJson();

  // Get session name from transcript
  let sessionName: string | null = null;
  if (hookInput?.transcript_path) {
    sessionName = getSessionName(hookInput.transcript_path);
  }

  // Determine what to check: session name if available, otherwise task list ID
  const nameToCheck = sessionName || taskListId || "";

  // Get keywords to check (default: "dev")
  const keywords = (process.env.CHECK_TASKS_KEYWORDS || "dev")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  // Only block stop for sessions matching configured keywords
  const matchesKeyword = keywords.some((keyword) =>
    nameToCheck.toLowerCase().includes(keyword)
  );

  if (!matchesKeyword) {
    // Not a matching session, allow stop
    approve();
  }

  const tasksDir = join(homedir(), ".claude", "tasks", taskListId!);

  if (!existsSync(tasksDir)) {
    // Task directory doesn't exist, allow stop
    approve();
  }

  const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".json"));

  if (taskFiles.length === 0) {
    // No tasks, allow stop
    approve();
  }

  const tasks: Task[] = taskFiles.map((file) => {
    const content = readFileSync(join(tasksDir, file), "utf-8");
    return JSON.parse(content) as Task;
  });

  const pending = tasks.filter((t) => t.status === "pending");
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const completed = tasks.filter((t) => t.status === "completed");

  const remainingCount = pending.length + inProgress.length;

  if (remainingCount > 0) {
    // Get first few pending task subjects for context
    const nextTasks = pending
      .slice(0, 3)
      .map((t) => `- ${t.subject}`)
      .join("\n");

    const prompt = `
STOP BLOCKED: You have ${remainingCount} tasks remaining (${pending.length} pending, ${inProgress.length} in progress, ${completed.length} completed).

You MUST continue working. Do NOT stop until all tasks are completed.

Next pending tasks:
${nextTasks}
${pending.length > 3 ? `... and ${pending.length - 3} more pending tasks` : ""}

INSTRUCTIONS:
1. Use TaskList to see all tasks
2. Pick the next pending task
3. Use TaskUpdate to mark it as in_progress
4. Complete the task
5. Use TaskUpdate to mark it as completed
6. Repeat until all tasks are done

DO NOT STOP. Continue working now.
`.trim();

    block(prompt);
  }

  // All tasks completed, allow stop
  approve();
}

main();
