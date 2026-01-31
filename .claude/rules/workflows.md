# Multi-Agent Workflow Patterns

Ideal patterns for coordinating multiple parallel agents in development workflows.

## Core Principles

1. **Purpose-Oriented Splitting** - Split work by domain/purpose, not arbitrary division
2. **Independent Execution** - Agents must not interfere with each other (no shared state)
3. **Focused Scopes** - Each agent has clear, narrow scope with specific output expectations
4. **Sequential Coordination** - Controller orchestrates; agents work independently then report back

---

## When to Launch Multiple Agents

### Code Explorers (Discovery Phase)

**Use 2-3 code-explorer agents in parallel when:**
- You need comprehensive understanding of a feature area
- Multiple aspects need investigation (architecture, implementation, patterns)
- Explorations are independent (no dependencies between findings)

**Example scopes:** Component structure, state management, integration points

```typescript
Task({
  subagent_type: "feature-dev:code-explorer",
  prompt: "Find features similar to [feature] and trace through their implementation comprehensively"
})
```

**After agents return:** Read all identified files, build understanding, present summary.

### Code Architects (Design Phase)

**Use 2-3 code-architect agents in parallel when:**
- You need multiple architectural approaches with different trade-offs
- Exploring design space from different angles

**Example scopes:** Minimal changes, clean architecture, pragmatic balance

```typescript
Task({
  subagent_type: "feature-dev:code-architect",
  prompt: "Design implementation for [feature] focusing on minimal changes - smallest diff, maximum reuse"
})
```

**After agents return:** Review approaches, compare trade-offs, provide recommendation, ask user to choose.

### Code Reviewers (Quality Phase)

**Use 3 code-reviewer agents in parallel when:**
- You need comprehensive coverage of different quality dimensions
- Reviewing recent changes for production readiness

**Example scopes:** Simplicity/DRY, bugs/correctness, conventions/architecture

```typescript
Task({
  subagent_type: "feature-dev:code-reviewer",
  prompt: "Review recent changes focusing on simplicity, DRY principles, code elegance"
})
```

**After agents return:** Consolidate findings, identify high-severity issues, ask user how to proceed.

### Specialized Grid Games Agents

**Use specialized agents in parallel with code-reviewers when:**
- Reviewing game-specific code (Phaser scenes, Socket.IO integration)
- Reviewing smart contracts and Web3 integration
- Domain-specific expertise needed beyond general code quality

**Game Logic Reviewer:**
```typescript
Task({
  subagent_type: "general-purpose",
  agentConfig: "agents/game-logic-reviewer.md",
  prompt: "Review TradingScene.ts for multiplayer reliability issues"
})
```

**Focus:** Memory leaks, race conditions, Phaser lifecycle, Socket.IO reliability, performance

**Web3 Auditor:**
```typescript
Task({
  subagent_type: "general-purpose",
  agentConfig: "agents/web3-auditor.md",
  prompt: "Review LiquidityVault.sol for security and gas optimization"
})
```

**Focus:** Reentrancy, access control, gas optimization, ethers.js integration, testing coverage

**Parallel Review Example:**
```typescript
// Launch 3 agents in parallel for comprehensive review
Task({
  subagent_type: "general-purpose",
  agentConfig: "agents/game-logic-reviewer.md",
  prompt: "Review game logic for multiplayer issues"
})
Task({
  subagent_type: "feature-dev:code-reviewer",
  prompt: "Review code quality and simplicity"
})
Task({
  subagent_type: "feature-dev:code-reviewer",
  prompt: "Review architecture and conventions"
})

// After agents return: Consolidate findings by severity
```

**Integration with Contract Deploy:**
```
2. Invokes web3-auditor agent for post-deployment review
3. Can run in parallel with code-reviewer agents for comprehensive validation
```

**After agents return:** Consolidate findings grouped by severity (Critical/Important/Minor), present action items.

### Code Simplifiers (Refactoring Phase)

**Use 2-4 code-simplifier agents in parallel when:**
- Explorers have identified files needing simplification
- Files are independent (no shared imports/state)

**Example scopes:** Contract scripts, game scripts, shared utilities, frontend hooks

```typescript
Task({
  subagent_type: "code-simplifier:code-simplifier",
  prompt: "Simplify contract scripts in contracts/scripts/ focusing on reducing complexity"
})
```

**After agents return:** Review summaries, verify no conflicts, run full verification, consolidate changes.

---

## Multi-Agent Handoff Pattern

**Core principle:** When launching multiple agents for a phase, consider handoff to multiple agents for the next phase. Instead of funneling exploration results through a single implementer, launch multiple parallel agents matched to the exploration scope.

**Flow:** N Explorers → Controller synthesizes → M Implementers (matched to scope)

| Exploration | Execution | Example |
|-------------|-----------|---------|
| 4 code-explorers (different domains) | 3 code-simplifiers (grouped by workload) | Simplify game state |
| 3 code-architects (different approaches) | 1 implementer (chosen approach) | Feature development |
| 2 code-explorers (aspect split) | 2 code-simplifiers (same split) | Refactor UI vs state |

**Benefits:** Workload balance, parallel execution (3x speed), context preservation, independent verification

**Critical rules:**
1. Never overlap work - Each implementer must have disjoint file sets
2. Verify independence - No shared imports or state between work groups
3. Run full verification - After all implementers complete, test everything together
4. Spot check integration - Verify boundaries between groups work correctly

---

## Purpose-Oriented Task Splitting

### Independent Problem Domains

**Split by problem domain when:**
- Multiple failures exist across different subsystems
- Each problem can be understood without context from others
- No shared state between investigations
- Fixing one won't affect others

**Good splitting:** By feature/module, by concern (UI vs logic vs data), by problem type (timing bugs vs logic errors), by file boundary

**Bad splitting:** Arbitrary line ranges in same file, interdependent functions, shared mutable state, tightly coupled concerns

---

## Coordination Patterns

### Pattern 1: Parallel Exploration → Sequential Read

1. Launch N agents in parallel (same type, different scopes)
2. Wait for all agents to complete
3. Read all files/outputs identified by agents
4. Build comprehensive understanding
5. Present consolidated findings

**Used in:** Codebase exploration, architecture design

### Pattern 2: Parallel Independent Execution → Integration

1. Identify N independent problem domains
2. Launch N agents in parallel (each with focused scope)
3. Wait for all agents to complete
4. Review each agent's summary
5. Verify fixes don't conflict
6. Run full verification (tests, linting)
7. Integrate all changes

**Used in:** Debugging multiple failures, simplification batches

### Pattern 3: Sequential Agent Pipeline with Review Loops

```
For each task:
  1. Dispatch implementer agent
  2. Implementer asks questions → Answer
  3. Implementer implements, tests, commits, self-reviews
  4. Dispatch spec compliance reviewer
  5. If issues → Implementer fixes → Re-review (loop until approved)
  6. Dispatch code quality reviewer
  7. If issues → Implementer fixes → Re-review (loop until approved)
  8. Mark task complete
```

**Critical rules:** Never skip reviews, never proceed with unfixed issues, never dispatch multiple implementation agents in parallel, always re-review after fixes, spec compliance must pass BEFORE code quality review

**Used in:** Subagent-driven development, plan execution

---

## Agent Prompt Best Practices

- **Focused scopes:** "Fix game.service.ts" (specific) vs "Fix all the code" (too broad)
- **Self-contained context:** Paste error messages, relevant code, file paths
- **Clear constraints:** "Do NOT change production code" or "Fix tests only"
- **Specific output requirements:** "Return summary of root cause and changes made"

## When NOT to Use Parallel Agents

- Related failures (fixing one might fix others - investigate together first)
- Need full context (understanding requires seeing entire system)
- Exploratory debugging (you don't know what's broken yet)
- Shared state (agents would interfere - editing same files, using same resources)
- Tightly coupled tasks (dependencies between tasks require sequential execution)

---

## Real-World Example: Feature Development

```
Phase 1: Discovery → User provides feature description

Phase 2: Codebase Exploration (PARALLEL)
  → Launch 2-3 code-explorer agents (different aspects)
  → Wait, read files, present findings

Phase 3: Clarifying Questions → Present organized questions, wait for answers

Phase 4: Architecture Design (PARALLEL)
  → Launch 2-3 code-architect agents (different approaches)
  → Present trade-offs, provide recommendation, ask user to choose

Phase 5: Implementation → Implement following chosen architecture

Phase 6: Quality Review (PARALLEL)
  → Launch 3 code-reviewer agents (different focuses)
  → Consolidate findings, ask user what to fix

Phase 7: Summary
```

## Real-World Example: Game Feature with Specialized Agents

```
Phase 1: User requests "Add multiplayer battle scene"

Phase 2: Codebase Exploration (PARALLEL)
  → code-explorer agent: Analyze TradingScene (multiplayer patterns)
  → code-explorer agent: Analyze GridScene (gameplay patterns)

Phase 3: Architecture Design
  → game-component skill generates scene with proper patterns
  → Auto-format and type-check via hooks

Phase 4: Quality Review (PARALLEL)
  → game-logic-reviewer agent: Check for memory leaks, race conditions
  → code-reviewer agent: Check code quality
  → code-reviewer agent: Check architecture

Phase 5: Consolidate findings and fix issues
```

## Real-World Example: Contract Deployment with Security Review

```

  → Deploy to network
  → Verify on Etherscan
  → Extract ABI to frontend

Phase 3: Security Review (PARALLEL)
  → web3-auditor agent: Security and gas review
  → code-reviewer agent: Solidity code quality
  → code-reviewer agent: Testing coverage

Phase 4: Consolidate findings
  → If Critical issues: Fix before using in production
  → If Important issues: Document and accept risk
  → If Minor issues: Note for future improvement
```

---

## Key Benefits

1. **Parallelization** - Multiple investigations happen simultaneously
2. **Focus** - Each agent has narrow scope, less context to track
3. **Independence** - Agents don't interfere with each other
4. **Coverage** - Multiple perspectives on same problem (different focuses)
5. **Speed** - N problems solved in time of 1 (when truly independent)

## Verification After Parallel Execution

1. Review each summary - Understand what changed
2. Check for conflicts - Did agents edit same code?
3. Run full suite - Verify all fixes work together
4. Integrate changes - Merge all agent outputs
5. Final verification - Tests, linting, type checking
