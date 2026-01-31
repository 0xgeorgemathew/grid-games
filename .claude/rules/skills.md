# Grid Games Agent & Skill Configuration

> Grid Games: Real-time multiplayer web game with blockchain settlement (Next.js + Phaser + Foundry).

---

## Tool Types

| Tool   | Usage                          | Purpose                                  |
| ------ | ------------------------------ | ---------------------------------------- |
| `Skill` | `Skill("name", "description")` | Orchestrates multi-phase workflows       |
| `Task`  | `Task({ subagent_type, ... })` | Executes specialized tasks autonomously |

---

## Superpowers Plugin (Official)

**Priority**: Always check if a superpowers skill applies before starting work.

| Skill                          | Invocation                                           | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| **Process**                    |                                                      |                                                      |
| `brainstorming`                | `Skill("superpowers:brainstorming")`                 | Creative work, exploring options                     |
| `systematic-debugging`         | `Skill("superpowers:systematic-debugging")`          | Bugs, test failures                                  |
| `writing-plans`                | `Skill("superpowers:writing-plans")`                 | Multi-step tasks from specs                          |
| **Execution**                  |                                                      |                                                      |
| `test-driven-development`      | `Skill("superpowers:test-driven-development")`       | Writing tests before code                            |
| `executing-plans`              | `Skill("superpowers:executing-plans")`               | Following written plans                              |
| `subagent-driven-development`  | `Skill("superpowers:subagent-driven-development")`   | Executing via parallel subagents                     |
| **Quality**                    |                                                      |                                                      |
| `verification-before-completion`| `Skill("superpowers:verification-before-completion")`| Before claiming work is complete                     |
| `requesting-code-review`       | `Skill("superpowers:requesting-code-review")`        | Reviewing work before merging                        |
| `receiving-code-review`        | `Skill("superpowers:receiving-code-review")`         | Applying review feedback                             |
| **Utility**                    |                                                      |                                                      |
| `using-superpowers`            | `Skill("superpowers:using-superpowers")`             | Entry point: establishes rules at start              |
| `finishing-a-development-branch`| `Skill("superpowers:finishing-a-development-branch")`| Decide merge/PR/cleanup                              |
| `using-git-worktrees`          | `Skill("superpowers:using-git-worktrees")`           | Create isolated worktrees                            |
| `dispatching-parallel-agents`  | `Skill("superpowers:dispatching-parallel-agents")`   | Launch 2+ independent tasks                           |
| `writing-skills`               | `Skill("superpowers:writing-skills")`                | Create or edit custom skills                         |

---

## Functional Skills

| Skill                    | Invocation                                   | Purpose                                               |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------- |
| **Git**                  |                                              |                                                       |
| `commit`                 | `Skill("commit-commands:commit")`            | Create a git commit with staged changes               |
| `commit-push-pr`         | `Skill("commit-commands:commit-push-pr")`    | Commit, push to remote, and open a PR                 |
| `clean_gone`             | `Skill("commit-commands:clean_gone")`        | Clean up [gone] branches and remove worktrees         |
| **Documentation**        |                                              |                                                       |
| `revise-claude-md`       | `Skill("claude-md-management:revise-claude-md")`| Update CLAUDE.md with learnings from current session |
| `claude-md-improver`     | `Skill("claude-md-management:claude-md-improver")`| Audit and improve CLAUDE.md files                    |
| **Code Review**          |                                              |                                                       |
| `code-review`            | `Skill("code-review:code-review")`           | Review a pull request for bugs and quality issues     |
| **Project-Specific**     |                                              |                                                       |
| `feature-dev`            | `Skill("feature-dev:feature-dev", "...")`    | Full workflow: discover → explore → plan → implement  |
| `frontend-design`        | `Skill("frontend-design", "...")`            | UI/UX components with design frameworks               |

---

## Agents (`Task` tool)

**Use superpowers-based agent patterns** from `.claude/rules/workflows.md` for multi-agent coordination.

| Agent                   | `subagent_type`                  | Purpose                                      |
| ----------------------- | -------------------------------- | -------------------------------------------- |
| **Official Plugins**    |                                  |                                              |
| `code-explorer`         | `feature-dev:code-explorer`      | Trace code flow, map architecture            |
| `code-architect`        | `feature-dev:code-architect`     | Design architecture, create blueprints       |
| `code-reviewer`         | `feature-dev:code-reviewer`      | Review code (confidence ≥ 80)                |
| `code-simplifier`       | `code-simplifier:code-simplifier`| Refine recently modified code                |
| `general-purpose`       | `general-purpose`                | Multi-step tasks with all tools              |

---

## Workflow Reference

For multi-agent coordination patterns, parallel execution strategies, and detailed workflows, see `.claude/rules/workflows.md`.
