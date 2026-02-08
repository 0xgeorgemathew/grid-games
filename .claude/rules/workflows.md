# Grid Games Workflow Reference

> Superpowers plugin handles orchestration. This doc maps project-specific agents to superpowers skills.

## Superpowers Quick Reference

```bash
# Process (before starting work)
Skill("superpowers:brainstorming")          # Creative work, exploring options
Skill("superpowers:systematic-debugging")   # Bugs, test failures
Skill("superpowers:writing-plans")          # Multi-step tasks from specs

# Execution
Skill("superpowers:executing-plans")        # Following written plans
Skill("superpowers:subagent-driven-development")  # Executing via parallel subagents
Skill("superpowers:test-driven-development")      # Writing tests before code

# Quality
Skill("superpowers:verification-before-completion")  # Before claiming done
Skill("superpowers:requesting-code-review")         # Review before merging
Skill("superpowers:receiving-code-review")          # Applying feedback

# Utility
Skill("superpowers:finishing-a-development-branch") # Decide merge/PR/cleanup
Skill("superpowers:dispatching-parallel-agents")    # Launch 2+ independent tasks
```

## Grid Games Specialized Agents

Use with `general-purpose` Task + `agentConfig` for domain-specific review:

| Agent | Config | Focus Areas |
|-------|--------|-------------|
| **Game Logic Reviewer** | `agents/game-logic-reviewer.md` | Memory leaks, race conditions, Phaser lifecycle, Socket.IO reliability, performance |
| **Web3 Auditor** | `agents/web3-auditor.md` | Reentrancy, access control, gas optimization, ethers.js integration, test coverage |

### Usage Pattern

```typescript
// After feature completion: parallel review (domain + general)
Task({ subagent_type: "general-purpose", agentConfig: "agents/game-logic-reviewer.md", prompt: "..." })
Task({ subagent_type: "feature-dev:code-reviewer", prompt: "Review code quality" })
// Consolidate findings by severity
```

### Severity Levels

- **Critical**: Fix before production
- **Important**: Document and accept risk
- **Minor**: Note for future

## Common Workflows

### Game Feature Development

```
Skill("superpowers:brainstorming") → explore options
→ Skill("game-component") → generate scene
→ Skill("superpowers:dispatching-parallel-agents") → review (game-logic-reviewer + code-reviewers)
→ Skill("superpowers:verification-before-completion")
→ Skill("superpowers:finishing-a-development-branch")
```

### Contract Deployment

```
Deploy → Verify on Etherscan
→ Skill("superpowers:dispatching-parallel-agents") → security review (web3-auditor + code-reviewers)
→ Consolidate: Critical=fixed, Important=accepted, Minor=future
```

### Bug Fix

```
Skill("superpowers:systematic-debugging") → root cause
→ Fix issue
→ Skill("superpowers:verification-before-completion")
→ Skill("commit-commands:commit")
```

### ENS Feature Development

```
Skill("superpowers:writing-plans") → design ENS text record schema
→ Update frontend/lib/ens.ts (contract addresses, ABIs)
→ Add hooks to frontend/hooks/useENS.ts
→ Create UI components in frontend/components/ens/
→ Skill("superpowers:verification-before-completion")
→ Skill("commit-commands:commit")
```

## Integration Points

| Context | Superpower | Follow-up |
|---------|-----------|-----------|
| New game feature | `brainstorming` → `game-component` | `game-logic-reviewer` agent |
| ENS feature | `writing-plans` → `executing-plans` | Type checking, contract verification |
| Yellow channel | `systematic-debugging` → `executing-plans` | L2 integration testing |
| Contract changes | `writing-plans` | `web3-auditor` agent |
| Multi-file changes | `dispatching-parallel-agents` | Parallel code-reviewers |
| Before merging | `verification-before-completion` | `requesting-code-review` |
