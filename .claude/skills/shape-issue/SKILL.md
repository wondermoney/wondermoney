---
name: shape-issue
description: Settles the open product decisions of a GitHub issue before anyone implements it, and writes the decisions and acceptance criteria back to the issue. Use when an issue is vague, has competing options, or was filed from an idea or a competitor's feature.
---

# Shape an issue

An issue is **shaped** when a worker could implement it without making a product decision.
Shaping settles those decisions with the person, one at a time, and records them on the issue.

## Steps

1. **Read** the issue with its comments, its epic and the issues it links
   (`gh issue view <n> --comments`), the code it would change, and
   `.agents/product-marketing.md` for who the product is for.

2. **State the case** in three lines: who has the problem, what they do today, and what changes
   for them when the issue is done. If nobody in the audience has the problem, say so and
   recommend closing the issue; a competitor shipping the feature is context, never the case.

3. **List the open decisions.** Walk each of these and write down every point where two
   reasonable implementations would behave differently:
   - what the person sees and does, on web and on mobile;
   - the edge cases: empty, first use, mixed currencies, shared households, private accounts,
     synced against manual accounts, existing data;
   - money semantics: what counts in which total, at which rate, on which date;
   - the data model, and whether existing rows need a value;
   - hosted against self-hosted: settings, defaults, optional integrations;
   - what is deliberately left out.

4. **Answer what the repository can answer**: the glossary (`apps/api/GLOSSARY.md`), the docs
   site, how neighbouring features behave, earlier decisions on linked issues. Keep only the
   decisions that are the person's to make.

5. **Ask** those one at a time as a multiple-choice question, your recommendation first with
   its reason. Follow each answer where it leads before moving on: an answer often opens a new
   decision. Done when no remaining question would change the implementation.

6. **Write it back** to the issue body, keeping the tracker's form:
   - **Problem** and **Proposal**, rewritten to match what was decided;
   - **Decisions**: each one as a statement, binding on the implementer;
   - **Acceptance criteria**: a checklist where each line can be checked by a test or by
     looking at a screen, covering each client, the locales and the docs;
   - **Not in scope**.

   Work too large for one pull request is split into issues linked under the epic, each with
   its blockers named.

7. **Label**: `ready-for-agent`, or `ready-for-human` when it needs an account, a credential or
   a call only the person can make; a `priority:*` label; the area labels.
