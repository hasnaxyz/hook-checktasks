# hook-checktasks

A Claude Code hook that prevents Claude from stopping when there are pending tasks in your task list.

## What it does

When you have a task list configured (`CLAUDE_CODE_TASK_LIST_ID`), this hook:

1. Checks if the session name or task list ID contains "dev" (configurable)
2. Reads the task list from `~/.claude/tasks/{taskListId}/`
3. If there are pending or in-progress tasks, **blocks the stop** and prompts Claude to continue working
4. Only allows stopping when all tasks are completed

This ensures Claude doesn't abandon work mid-session.

## Installation

### Prerequisites

- [Bun](https://bun.sh/) runtime installed

### Option 1: Global Installation

Install once and it works for all Claude Code sessions:

```bash
./install.sh --global
```

### Option 2: Per-Project Installation

Install for a specific project:

```bash
./install.sh /path/to/your/project
# or
./install.sh .  # current directory
```

### Manual Installation

1. Copy `check-tasks.ts` to your hooks directory:
   - Global: `~/.claude/hooks/check-tasks.ts`
   - Project: `.claude/hooks/check-tasks.ts`

2. Make it executable:
   ```bash
   chmod +x check-tasks.ts
   ```

3. Add to your `settings.json` (global: `~/.claude/settings.json`, project: `.claude/settings.json`):
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "bun \"$CLAUDE_PROJECT_DIR/.claude/hooks/check-tasks.ts\"",
               "timeout": 120
             }
           ]
         }
       ]
     }
   }
   ```

## Configuration

Configure via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_CODE_TASK_LIST_ID` | Task list to monitor (required for task checking) | - |
| `CHECK_TASKS_KEYWORDS` | Comma-separated keywords that trigger the check | `dev` |
| `CHECK_TASKS_DISABLED` | Set to `1` to disable the hook | - |

### Examples

```bash
# Standard usage with dev task list
CLAUDE_CODE_TASK_LIST_ID=myproject-dev claude

# Check for "dev" or "sprint" sessions
CHECK_TASKS_KEYWORDS=dev,sprint CLAUDE_CODE_TASK_LIST_ID=myproject-dev claude

# Temporarily disable the hook
CHECK_TASKS_DISABLED=1 claude
```

## How it works

1. **On Stop hook trigger**: Claude is about to stop/exit
2. **Check session name**: Reads the session name from transcript (if available)
3. **Keyword matching**: Checks if session name or task list ID contains configured keywords
4. **Task count**: Reads task files from `~/.claude/tasks/{taskListId}/`
5. **Decision**:
   - If tasks remain: Block stop with instructions to continue
   - If all complete: Allow stop

## Task File Format

Tasks are stored as JSON files in `~/.claude/tasks/{taskListId}/`:

```json
{
  "id": "task-001",
  "subject": "Implement user authentication",
  "status": "pending"
}
```

Status values: `pending`, `in_progress`, `completed`

## License

MIT
