---
name: whats-next
description: Recommends what WonderMoney should work on next, by ranking the open issues and epics, and lists the epics and issues that can be closed. Use when asked what's next, what to start, for next steps, or whether epics can be closed.
---

# What's next

The answer is a ranked recommendation with one pick, grounded in the tracker and the code. It
is about priorities; what is running right now belongs to the work-issues skill.

## Gather

```bash
gh issue list --state open --limit 200 --json number,title,labels,updatedAt
gh issue list --state open --label epic --json number,title
gh api repos/{owner}/{repo}/issues/<epic>/sub_issues --jq '.[] | "\(.number) \(.state) \(.title)"'
gh pr list --state open --json number,title,isDraft,statusCheckRollup
git fetch origin main develop --tags
git log --first-parent --oneline origin/main..origin/develop
```

Read `.agents/product-marketing.md` for the audience and the goals, and the public roadmap the
README links.

## Rank

Score each open, unblocked issue on four things and say the score in words:

- **Value**: how many people in the audience it helps, and how much. A bug in money, sync or
  data integrity outranks any feature.
- **Reach of the fix**: whether it unblocks other issues or closes an epic.
- **Effort**: one pull request, several, or needs shaping first.
- **Risk**: touches money arithmetic, tenancy, auth or a migration.

## Answer

1. **Pick**: the one thing to start now, and why it beats the next two.
2. **Next**: up to four more, in order, each with one line of reasoning.
3. **Can be closed**: an epic qualifies when every sub-issue is closed and each line of its
   "Done when" holds; check each line against the code and the docs, and name the line that
   fails when one does. An issue qualifies when a merged pull request already did it.
4. **Needs shaping**: issues with open product decisions (the `shape-issue` skill).
5. **Waiting on the person**: `ready-for-human` issues, each as the decision or action needed.
6. **Unreleased**: how many pull requests sit on `develop` and not on `main`, and whether a
   release is due (the `prepare-deploy` skill).

When fewer than three issues are ready, propose new candidates and say where each comes from:
community issues and discussions, follow-ups named in merged pull requests, the "Not in scope"
lines of closed epics, and gaps between the landing page's claims and the product.

Close an epic or issue only on the person's word; offer the list as a multiple-choice question.
