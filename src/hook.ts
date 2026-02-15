#!/usr/bin/env bun

/**
 * Claude Code Hook: check-tasks
 *
 * Prevents Claude from stopping when there are pending/in-progress tasks.
 *
 * Configuration priority:
 * 1. settings.json checkTasksConfig (project or global)
 * 2. Environment variables (legacy)
 *
 * Config options:
 * - taskListId: specific list to check, or undefined = auto-detect for current project
 * - keywords: keywords to match task list names (default: ["dev"])
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
    keywords: process.env.CHECK_TASKS_KEYWORDS?.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean) || ["dev"],
    enabled: process.env.CHECK_TASKS_DISABLED !== "1",
  };
}

function getSessionName(transcriptPath: string): string | null {
  if (!existsSync(transcriptPath)) return null;

  try {
    const content = readFileSync(transcriptPath, "utf-8");
    let lastTitle: string | null = null;
    let searchStart = 0;

    while (true) {
      const titleIndex = content.indexOf('"custom-title"', searchStart);
      if (titleIndex === -1) break;

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

function getAllTaskLists(): string[] {
  const tasksDir = join(homedir(), ".claude", "tasks");
  if (!existsSync(tasksDir)) return [];
  try {
    return readdirSync(tasksDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Extract meaningful name segments from a cwd path for matching against task list names.
 *
 * For a path like /Users/hasna/Workspace/hasnastudio/hasnastudio-alumia/platform/platform-alumia
 * this returns identifiers like: ["platform-alumia", "hasnastudio-alumia", "hasnastudio"]
 *
 * We skip generic segments like "Workspace", "Users", "platform", "src", etc.
 */
function getProjectIdentifiers(cwd: string): string[] {
  const genericSegments = new Set([
    "users", "home", "workspace", "workspaces", "projects", "repos",
    "src", "lib", "app", "apps", "packages", "platform", "service",
    "services", "web", "api", "server", "client", "frontend", "backend",
    "dev", "development", "prod", "staging", "tmp", "temp", "var",
    "opt", "usr", "volumes",
  ]);

  const segments = cwd.split("/").filter(Boolean);

  // Collect meaningful segments (skip generic ones and very short ones)
  const identifiers: string[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.length < 3) continue;
    if (genericSegments.has(seg.toLowerCase())) continue;
    // Skip user home directory name
    if (i <= 2) continue;
    identifiers.push(seg);
  }

  return identifiers;
}

/**
 * Find task lists that belong to the current project.
 *
 * Uses the cwd path segments to match against named (non-UUID) task lists.
 * UUID task lists are ignored since they cannot be meaningfully matched.
 *
 * A task list matches if it starts with a project identifier followed by a separator,
 * or is an exact match.
 */
function getProjectTaskLists(cwd: string): string[] {
  const allLists = getAllTaskLists();
  const identifiers = getProjectIdentifiers(cwd);

  // Only consider named task lists (skip UUIDs)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const namedLists = allLists.filter((list) => !uuidRegex.test(list));

  if (namedLists.length === 0 || identifiers.length === 0) return [];

  // Score each list by how well it matches the project identifiers.
  // Priority: the LAST segment of cwd (project root name) gets highest priority.
  const scored: Array<{ list: string; score: number }> = [];

  for (const list of namedLists) {
    const listLower = list.toLowerCase();
    let bestScore = 0;

    for (let i = 0; i < identifiers.length; i++) {
      const idLower = identifiers[i].toLowerCase();
      // Priority decreases as we go further from the project root
      const priorityWeight = identifiers.length - i;

      if (listLower === idLower) {
        // Exact match - highest score
        bestScore = Math.max(bestScore, priorityWeight * 100);
      } else if (listLower.startsWith(idLower + "-")) {
        // Prefix match (e.g., "platform-alumia" matches "platform-alumia-dev")
        bestScore = Math.max(bestScore, priorityWeight * 10);
      }
    }

    if (bestScore > 0) {
      scored.push({ list, score: bestScore });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s) => s.list);
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

  const keywords = config.keywords || ["dev"];

  // Determine which task lists to check
  let listsToCheck: string[] = [];

  if (config.taskListId) {
    // Specific list configured - only check that one
    listsToCheck = [config.taskListId];
  } else {
    // Auto-detect: find task lists that belong to this project
    const projectLists = getProjectTaskLists(cwd);

    if (projectLists.length > 0) {
      // Filter by keywords so we only check relevant lists
      // (e.g., "platform-alumia-dev" matches keyword "dev")
      if (keywords.length > 0) {
        const keywordMatched = projectLists.filter((list) =>
          keywords.some((keyword) => list.toLowerCase().includes(keyword.toLowerCase()))
        );
        // If keyword filter matches some lists, use those; otherwise use all project lists
        listsToCheck = keywordMatched.length > 0 ? keywordMatched : projectLists;
      } else {
        listsToCheck = projectLists;
      }
    }
    // If no project-specific lists found, don't check any (don't aggregate all lists)
  }

  if (listsToCheck.length === 0) {
    // No matching task lists for this project, allow stop
    approve();
  }

  // Get session name from transcript (used for keyword check on the session itself)
  let sessionName: string | null = null;
  if (hookInput?.transcript_path) {
    sessionName = getSessionName(hookInput.transcript_path);
  }

  // If we have a session name, check if it matches keywords.
  // This allows non-"dev" sessions to stop freely even if the project has task lists.
  if (sessionName && keywords.length > 0) {
    const sessionMatchesKeyword = keywords.some((keyword) =>
      sessionName!.toLowerCase().includes(keyword.toLowerCase())
    );
    // Also check if the task list name itself matches (for explicit taskListId)
    const listMatchesKeyword = config.taskListId
      ? keywords.some((keyword) => config.taskListId!.toLowerCase().includes(keyword.toLowerCase()))
      : true; // When auto-detected, lists are already keyword-filtered above

    if (!sessionMatchesKeyword && !listMatchesKeyword) {
      // Session name doesn't match keywords, allow stop
      approve();
    }
  }

  // Collect tasks from matching lists
  let allPending: Task[] = [];
  let allInProgress: Task[] = [];
  let allCompleted: Task[] = [];
  let activeListId: string | null = null;

  for (const listId of listsToCheck) {
    const tasks = getTasksFromList(listId);
    const pending = tasks.filter((t) => t.status === "pending");
    const inProgress = tasks.filter((t) => t.status === "in_progress");
    const completed = tasks.filter((t) => t.status === "completed");

    if (pending.length > 0 || inProgress.length > 0) {
      activeListId = listId;
    }

    allPending.push(...pending);
    allInProgress.push(...inProgress);
    allCompleted.push(...completed);
  }

  const remainingCount = allPending.length + allInProgress.length;

  if (remainingCount > 0) {
    const nextTasks = allPending
      .slice(0, 3)
      .map((t) => `- ${t.subject}`)
      .join("\n");

    const listInfo = activeListId ? ` in "${activeListId}"` : "";

    const prompt = `
STOP BLOCKED: You have ${remainingCount} tasks remaining${listInfo} (${allPending.length} pending, ${allInProgress.length} in progress, ${allCompleted.length} completed).

DO NOT STOP. DO NOT ASK QUESTIONS. DO NOT WAIT FOR USER INPUT.

You MUST continue working AUTONOMOUSLY until ALL tasks are completed.

Next pending tasks:
${nextTasks}
${allPending.length > 3 ? `... and ${allPending.length - 3} more pending tasks` : ""}

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
