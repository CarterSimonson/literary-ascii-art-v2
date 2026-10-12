---
name: grab
description: Pick up and complete one actionable Linear ticket for this repository, using issue status, dependencies, and linked PRs to choose the next task. Use when asked to grab the next task or continue the ticket queue.
---

# Grab one ticket

Read the repository's AGENTS.md and its Linear project binding in the README.
Use the configured project, team workflow, and repository scope. If the binding
or Linear access is missing, report the setup needed before selecting work. Do
not guess a project from a similar name.

Inspect the working tree and fetch the remote's actual default branch. Start new
ticket branches from its current remote tip; preserve unrelated local work, using
an isolated worktree when needed. Resume an existing ticket branch or PR when
appropriate rather than starting a duplicate.

Choose one ticket from the project's current state, reading its details, comments,
dependencies, and linked PRs:

- Resume unfinished In Progress work that is not actively owned by another agent
  or contributor.
- Otherwise choose an unblocked Todo ticket, then an unblocked Backlog ticket,
  considering priority and which work it unlocks.
- Revisit In Review work only for actionable feedback or failing checks.
- Treat dependencies as complete only when their tickets are Done. If linked PRs
  reveal stale status, reconcile the evidence before relying on it.
- Exclude work for other repositories. Recheck status and ownership before claiming
  the ticket, briefly explain the selection, and move it to In Progress using the
  team's equivalent status.

Complete the ticket, verify its acceptance criteria, and open or update a PR.
Link the PR and record the changes, validation evidence, and remaining limitations
in Linear, then move the ticket to In Review. Mark it Done only after the change
is merged and its acceptance criteria are satisfied. This workflow does not
itself authorize merging or deployment.

If nothing is actionable, report why. If the selected ticket becomes blocked,
record the blocker and next step in Linear and report it; leave incomplete work
out of In Review. Stop after this ticket.
