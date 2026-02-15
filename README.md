# @hasnaxyz/hook-checktasks

A Claude Code hook that prevents Claude from stopping when there are pending tasks.

## What it does

This hook intercepts Claude's "Stop" event and:

1. Checks configured task lists for pending/in-progress tasks
2. If tasks remain → **blocks the stop** and prompts Claude to continue
3. If all complete → allows stop

**Zero config required.** Claude Code automatically sets the `CLAUDE_CODE_TASK_LIST_ID` environment variable with the correct task list ID for each session. The hook reads this automatically, so it just works out of the box -- no manual configuration needed.

## Installation

### 1. Install the CLI globally

```bash
bun add -g @hasnaxyz/hook-checktasks
# or
npm install -g @hasnaxyz/hook-checktasks
```

### 2. Install the hook

```bash
# Auto-detect (git repo → project, else → prompt)
hook-checktasks install

# Install globally
hook-checktasks install --global

# Install to specific path
hook-checktasks install /path/to/project
```

The installer will prompt you to configure:
- **Task list ID**: specific list or leave empty for all lists
- **Keywords**: session/list name keywords to trigger the check (default: "dev")

## Configuration

### Update configuration

```bash
hook-checktasks config              # Current project
hook-checktasks config --global     # Global settings
```

### Check status

```bash
hook-checktasks status
```

Shows:
- Where hook is installed (global/project)
- Current configuration
- Available task lists

### Uninstall

```bash
hook-checktasks uninstall           # Current project
hook-checktasks uninstall --global  # Global
hook-checktasks uninstall /path     # Specific path
```

## How Configuration Works

Configuration is stored in `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "bunx @hasnaxyz/hook-checktasks run" }] }]
  },
  "checkTasksConfig": {
    "taskListId": "myproject-dev",
    "keywords": ["dev"],
    "enabled": true
  }
}
```

### Config Options

| Option | Description | Default |
|--------|-------------|---------|
| `taskListId` | Specific task list to check, or `undefined` for all lists | `undefined` (all) |
| `keywords` | Keywords to match in session/list names | `["dev"]` |
| `enabled` | Enable/disable the hook | `true` |

### Task List Resolution Priority

The hook determines which task list to check in this order:

1. **`taskListId` in config** -- if explicitly set in settings.json, use that
2. **`CLAUDE_CODE_TASK_LIST_ID` env var** -- Claude Code automatically sets this per-session with the exact task list ID (e.g., `platform-alumia-dev`). No manual setup needed.
3. **cwd-based project detection** -- matches your working directory against named task lists

In most cases, step 2 handles everything automatically.

### Config Priority

1. Project settings (`.claude/settings.json`)
2. Global settings (`~/.claude/settings.json`)
3. Environment variables (legacy)

### Legacy Environment Variables

Still supported for backwards compatibility:

```bash
CHECK_TASKS_KEYWORDS=dev,sprint claude
CHECK_TASKS_DISABLED=1 claude
```

## CLI Commands

```
hook-checktasks install [path]     Install the hook
hook-checktasks config [path]      Update configuration
hook-checktasks uninstall [path]   Remove the hook
hook-checktasks status             Show hook status
hook-checktasks run                Execute hook (called by Claude Code)

Options:
  --global, -g   Apply to global settings
  /path/to/repo  Apply to specific project
```

## How it Works

```
Claude tries to stop
        │
        ▼
    Stop hook fires
        │
        ▼
    Read config from settings.json
        │
        ▼
    Resolve task list:
      1. taskListId in config?  → use that
      2. CLAUDE_CODE_TASK_LIST_ID env var?  → use that (auto, zero config)
      3. else → match cwd against named task lists
        │
        ▼
    Check tasks in resolved list
        │
        ├── Tasks remaining → BLOCK stop, prompt to continue
        │
        └── All complete → ALLOW stop
```

## License

MIT
