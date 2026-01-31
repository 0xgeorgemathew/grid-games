# Claude Code Automation - Quick Start Guide

## Immediate Setup (5 minutes)

### 1. Set Environment Variables

```bash
# Add to ~/.zshrc or ~/.bashrc
export GITHUB_TOKEN="ghp_xxx"  # Your GitHub personal access token

# Reload shell
source ~/.zshrc
```

Get GitHub token from: https://github.com/settings/tokens (need `repo` scope)

### 2. Restart Claude Code

Quit and restart Claude Code to load the new configuration.

### 3. Verify Setup

```bash
# Check MCP servers are loaded
claude mcp list

# Should see:
# - github
# - context7-filesystem
```

---

## How to Use Skills

### Method 1: Direct Conversation (Easiest)

Just ask me to use a skill:

```
You: "Create a BattleScene with power-ups and multiplayer support"

I will:
1. Use game-component skill automatically
2. Ask you questions about the scene
3. Generate the scene with proper patterns
4. Auto-format and type-check via hooks
```

### Method 2: Skill Invocation (Explicit)

```
You: "/game-component"

I will:
1. Launch the skill interactively
2. Guide you through scene creation step by step
```

### Method 3: Contract Deployment

```
You: "/contract-deploy"

I will:
1. Ask which contract and network
2. Deploy via Foundry
3. Verify on Etherscan
4. Extract ABI to frontend
5. Run security review
```

---

## How to Use Agents

### Review Game Code

```
You: "Review TradingScene.ts for multiplayer issues"

I will launch 3 agents in parallel:
1. game-logic-reviewer → Memory leaks, race conditions
2. code-reviewer → Code quality
3. code-reviewer → Architecture

Then consolidate findings by severity.
```

### Review Smart Contracts

```
You: "Review LiquidityVault.sol for security issues"

I will launch 3 agents in parallel:
1. web3-auditor → Security, gas optimization
2. code-reviewer → Solidity code quality
3. code-reviewer → Testing coverage

Then present findings with severity levels.
```

### After Making Changes

```
You: "I just updated the coin collection logic. Can you review it?"

I will:
1. Launch game-logic-reviewer agent
2. Check for race conditions in coin collection
3. Check for memory leaks
4. Report any issues found
```

---

## Real Workflows

### Workflow 1: Add New Game Feature

```
Step 1: Brainstorm
You: "I want to add a power-up system to HFT Battle"
Me: [Uses brainstorming skill to explore options]

Step 2: Design
You: "Let's do temporary speed boosts"
Me: [Launches 2 code-architect agents to design approach]

Step 3: Implement
You: "Go with the spatial hash approach"
Me: [Uses game-component skill to create PowerUpScene]

Step 4: Review
You: "Review the implementation"
Me: [Launches 3 parallel reviewers]
     - game-logic-reviewer (multiplayer issues)
     - code-reviewer (code quality)
     - code-reviewer (architecture)

Step 5: Commit
You: "Commit the changes"
Me: [Uses commit skill, hooks auto-format]
```

### Workflow 2: Deploy Contract

```
Step 1: Deploy
You: "/contract-deploy"
Me: "Which contract? LiquidityVault"
    "Which network? Sepolia"
    [Deploys, verifies, extracts ABI]

Step 2: Security Review
Me: [Launches web3-auditor + 2 code-reviewers in parallel]
    "Critical: Reentrancy vulnerability in withdraw()"
    "Important: 15% gas waste in deposit loop"

Step 3: Fix Issues
You: "Fix the reentrancy issue"
Me: [Implements ReentrancyGuard, hooks auto-format]

Step 4: Redeploy
You: "Deploy the fixed version"
Me: [Deploys again, security review passes]

Step 5: Commit
You: "Commit everything"
Me: [Uses commit skill with deployment details]
```

### Workflow 3: Debug Multiplayer Issue

```
Step 1: Report Issue
You: "Players are desyncing after collecting coins"
Me: [Uses systematic-debugging skill]

Step 2: Investigate
Me: [Launches game-logic-reviewer agent]
    "Found race condition: Client deletes coin immediately
     instead of waiting for server confirmation"

Step 3: Fix
You: "Fix the race condition"
Me: [Implements server confirmation pattern]

Step 4: Verify
You: "Review the fix"
Me: [Launches game-logic-reviewer to verify fix]

Step 5: Test & Commit
Me: [Runs tests, auto-formats, commits]
```

---

## Quick Reference Commands

### Game Development
```
"Create a [SceneName] scene with [features]"
"Review [file] for multiplayer issues"
"Add [feature] to TradingScene"
"Fix the memory leak in [scene]"
```

### Contract Development
```
"/contract-deploy"
"Review [contract] for security issues"
"Audit LiquidityVault for gas optimization"
"Add ReentrancyGuard to withdraw function"
```

### Code Quality
```
"Review my recent changes"
"Check for race conditions in [file]"
"Find performance issues in [scene]"
"Simplify the code in [file]"
```

### Git Workflow
```
"Commit these changes"
"Review this PR"
"Clean up gone branches"
```

---

## Common Patterns

### After Editing Any File
Hooks automatically:
1. Run Prettier formatting
2. Run TypeScript type-check
3. Block .env or lock file edits

### Before Merging
```
You: "Review everything before I merge"
Me: [Launches 3 code-reviewers + game-logic-reviewer]
    "Consolidated findings:
     - 1 Critical: Memory leak in TradingScene:156
     - 2 Important: Race conditions in coin collection
     - 3 Minor: Code quality improvements"
```

### After Contract Changes
```
You: "I updated LiquidityVault. Can you audit it?"
Me: [Launches web3-auditor + code-reviewers]
    "Security review:
     - Added ReentrancyGuard ✓
     - Signature verification missing ✗
     - Gas optimization: 12% savings possible"
```

---

## What Happens Automatically

You don't need to ask for these - they just happen:

✅ Every file edit → Auto-formatted with Prettier
✅ Every TypeScript edit → Type-checked
✅ .env file edits → Blocked for security
✅ bun.lockb edits → Blocked (use bun install)
✅ Scene creation → Follows HFT Battle patterns
✅ Contract deployment → Includes security review

---

## Tips

1. **Be specific**: "Review TradingScene.ts for race conditions" is better than "Review the game"

2. **Use shorthand**: `/game-component` is faster than explaining you want a scene

3. **Trust the process**: I'll automatically launch the right agents, you don't need to specify

4. **Read the reports**: Agent reviews group issues by severity - fix Critical first

5. **Leverage hooks**: Never manually format - hooks do it automatically

---

## Examples to Try Right Now

### Easy
```
"Create a MenuScene with start button"
"Review TradingScene.ts for memory leaks"
"Format all the code"
```

### Medium
```
"Add a particle system to TradingScene"
"Review LiquidityVault.sol and suggest gas optimizations"
"Create a power-up system for HFT Battle"
```

### Advanced
```
"Add a new game mode called 'Battle Royale' with 10 players"
"Audit the entire multiplayer system for security issues"
"Deploy a new version of LiquidityVault to mainnet"
```

---

## Getting Help

If something doesn't work:
```
You: "The game-component skill isn't working"
Me: [Troubleshoots the issue]

You: "How do I use the web3-auditor agent?"
Me: [Explains with examples]
```

---

**You're all set! Just start coding and the automation will help you along the way.**
