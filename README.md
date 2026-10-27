# Adperastra build plan

This folder is the complete build plan for Adperastra, split into small files so a coding AI can follow it without losing details.

## How to use it

1. Create an empty folder for the project and copy everything from this zip into it (keep the folder structure).
2. Open the folder in OpenCode and say: **"Follow AGENTS.md. Start with Step 00."** OpenCode loads `AGENTS.md` and the shared rule files listed in `opencode.json` automatically.
3. The AI works one step at a time. At the end of each step it gives you a report and waits. Test what it built, then reply **"go"** or tell it what to fix.

## What's inside

| File | What it is | When the AI reads it |
|---|---|---|
| `AGENTS.md` | The core: goal, decisions, how to work, roadmap, milestones | Always |
| `opencode.json` | Tells OpenCode to also load the shared rule files below | Automatically |
| `plan/rules.md` | Rules that apply to every step (settings, language, safety, sandboxing, file-system edge cases, help pages, licenses, large files) | Always |
| `plan/speed.md` | Speed standard and how to meet it | Always |
| `plan/git-and-testing.md` | Git workflow, branches, commits, local test suite | Always |
| `plan/contracts.md` | The plug-in points every feature builds on | Always |
| `plan/design.md` | What the Figma file contains and the screens still to design | When building UI |
| `plan/ai.md` | AI models, quality rules, evaluation | Steps 14c and 17a-22b |
| `plan/steps/step-XX.md` | One file per step | Only the current step |
| `plan/backlog.md` | Ideas for later, not to build yet | When planning |

## Release plan (milestones)

| Version | After step | What people get |
|---|---|---|
| v0.1 | 08c | Fast explorer with tabs, viewers for most files, converter, first downloadable release on GitHub |
| v0.2 | 10c | Power features, tab groups, full customization, accessibility |
| v0.3 | 13 | Search, tags, views, storage tools, optional packs, Office viewing |
| v0.4 | 16 | PDF and image editing, audio/video basics, Windows integration |
| v0.5 | 17d | Optional offline AI features |
| v1.0 | 22b | Advanced image and video editing, Office-style editing |

Each release is published on GitHub Releases as a free download (installer and portable zip), with no accounts needed.
