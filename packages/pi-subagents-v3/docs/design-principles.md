# Design principles

These principles define the intended direction of Pi Subagents v3 rather than requirements for every Pi subagent implementation.

## Context isolation is the purpose

Every subagent starts as a fresh Pi process without inheriting the main agent's conversation history.

A fresh context is not an empty environment: the child still receives Pi's system prompt, its agent definition, applicable project context, its allowed tools, and one explicit task.

Give each subagent a self-contained task containing only the context needed to complete that task.

Context isolation is the primary reason to use a subagent.

If work depends on substantial history from the current conversation, continue in the current thread instead of copying that history into a new subagent.

## Simplicity over feature breadth

Keep the architecture explicit, bounded, and easy to understand.

Do not introduce complex abstractions or orchestration merely to support more features.

Prefer a small, maintainable implementation over feature completeness.

Add a capability only when its value clearly justifies its implementation and ongoing maintenance cost.
