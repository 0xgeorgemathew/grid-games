# Grid Games Skills & Agents Reference

> Quick reference for when to use each skill/agent. See `.claude/rules/workflows.md` for workflow patterns.

## Superpowers Skills

**Check before starting work.**

| Skill | When to Use | Workflow |
|-------|-------------|----------|
| **Process** |||
| `brainstorming` | Creative work, feature design | Explore options → Ask questions → Present approaches |
| `systematic-debugging` | Bugs, test failures | Gather info → Form hypotheses → Verify → Fix |
| `writing-plans` | Multi-step tasks from specs | Break down → Identify dependencies → Create plan |
| **Execution** |||
| `executing-plans` | Following written plans | Read plan → Execute step → Verify → Next step |
| `subagent-driven-development` | Parallel independent tasks | Dispatch agents → Collect results → Integrate |
| `test-driven-development` | Writing tests first | Write failing test → Implement → Pass → Refactor |
| **Quality** |||
| `verification-before-completion` | Before claiming done | Run tests → Type check → Lint → Confirm |
| `requesting-code-review` | Pre-merge review | Launch reviewers → Consolidate findings → Fix issues |
| `receiving-code-review` | Applying feedback | Verify claims → Question unclear → Implement fixes |
| **Utility** |||
| `using-superpowers` | Start of conversation | Establishes which skills apply |
| `dispatching-parallel-agents` | 2+ independent tasks | Identify independence → Launch in parallel → Integrate |
| `using-git-worktrees` | Isolated feature work | Create worktree → Work → Cleanup |
| `finishing-a-development-branch` | After implementation | Run verification → Present merge/PR/cleanup options |
| `writing-skills` | Creating custom skills | Draft skill → Test → Deploy |

## Functional Skills

| Skill | When to Use | Workflow |
|-------|-------------|----------|
| **Git** |||
| `commit` | Commit staged changes | Stage → Write message → Commit |
| `commit-push-pr` | Full PR workflow | Commit → Push → Create PR |
| `clean_gone` | Cleanup stale branches | List gone → Remove branches → Cleanup worktrees |
| **Docs** |||
| `revise-claude-md` | Session learnings | Identify learnings → Update CLAUDE.md |
| `claude-md-improver` | Audit project docs | Scan files → Evaluate quality → Update |
| **Review** |||
| `code-review` | Review pull request | Analyze changes → Report issues |
| **Feature** |||
| `feature-dev` | Full feature workflow | Discover → Explore → Plan → Implement |
| `frontend-design` | UI/UX components | Understand requirements → Design → Implement |
| **Grid Games** |||
| `game-component` | Phaser scenes | Get requirements → Generate scene → Integrate |

## Agents (`Task` tool)

**Use `dispatching-parallel-agents` skill for multi-agent coordination.**

| Agent | When to Use | Workflow |
|-------|-------------|----------|
| **Official** |||
| `code-explorer` | Trace code flow, map architecture | Define scope → Explore → Report findings |
| `code-architect` | Design architecture approaches | Define requirements → Design → Present options |
| `code-reviewer` | Review code quality | Define focus → Review → Report issues (confidence ≥80%) |
| `code-simplifier` | Refine recently modified code | Identify complexity → Simplify → Verify |
| `general-purpose` | Multi-step with all tools | Full task → Use all tools autonomously |
| **Grid Games Custom** |||
| `game-logic-reviewer` | Phaser/Socket.IO multiplayer issues | Review → Report memory leaks, race conditions, performance |
| `web3-auditor` | Contract security/gas | Review → Report reentrancy, access control, optimization |
| `ens-integration` | ENS L2 operations, text records | Review → Report reverse lookup, batch updates, gas optimization |
| `yellow-channels` | Nitrolite integration, state channels | Review → Report channel creation, state signing, settlements |

### Custom Agent Usage

```typescript
// Game logic review
Task({
  subagent_type: "general-purpose",
  agentConfig: "agents/game-logic-reviewer.md",
  prompt: "Review TradingScene.ts for multiplayer reliability issues"
})

// Web3 audit
Task({
  subagent_type: "general-purpose",
  agentConfig: "agents/web3-auditor.md",
  prompt: "Review LiquidityVault.sol for security and gas optimization"
})
```

## Quick Decision Tree

```
Starting work?
├─ Creative/feature? → brainstorming
├─ Bug/test failure? → systematic-debugging
├─ Have spec? → writing-plans → executing-plans
└─ Not sure? → using-superpowers

Need parallel work?
└─ dispatching-parallel-agents

Done with code?
├─ verification-before-completion
└─ requesting-code-review → receiving-code-review

Done with feature branch?
└─ finishing-a-development-branch
```
