# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues at `orphic-inc/stellar-api`. Use the `gh` CLI for all operations.

**External PRs are not a triage surface.** `/triage` processes GitHub Issues only; pull requests (including external/feature-request PRs) are left out of the triage queue.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

How `/wayfinder`'s concepts map onto GitHub for this repo. Both sub-issues and issue dependencies are native here, so neither falls back to a body convention.

**The map** is an issue labelled `wayfinder:map`. Find the open ones with `gh issue list --label "wayfinder:map" --state open`.

**Tickets** are child issues of the map, each carrying one `wayfinder:<type>` label — `research`, `prototype`, `grilling`, or `task`.

**Parentage** uses the native sub-issue API. It takes the child's internal `id`, not its number, and the field must be sent as an integer (`-F`, not `-f` — `-f` sends a string and the API rejects it with a 422):

```bash
child_id=$(gh api repos/orphic-inc/stellar-api/issues/<child>/ --jq '.id')
gh api -X POST repos/orphic-inc/stellar-api/issues/<map>/sub_issues -F sub_issue_id="$child_id"
```

**Blocking** uses the native dependency relationship, which renders the frontier visually in GitHub's own UI. Same integer-`id` rule:

```bash
blocker_id=$(gh api repos/orphic-inc/stellar-api/issues/<blocker>/ --jq '.id')
gh api -X POST repos/orphic-inc/stellar-api/issues/<blocked>/dependencies/blocked_by -F issue_id="$blocker_id"
```

Read an issue's blockers with `gh api repos/orphic-inc/stellar-api/issues/<n>/dependencies/blocked_by --jq '[.[].number]'`.

**Claiming** a ticket is assigning it: `gh issue edit <n> --add-assignee obrien-k`. An open, unassigned ticket is unclaimed.

**The frontier** is the map's open children that are unassigned and have an empty `blocked_by` list. There is no single query for this — list the children, then check each one's dependencies:

```bash
gh api repos/orphic-inc/stellar-api/issues/<map>/sub_issues --jq '.[] | select(.state=="open") | .number'
```

**Resolving** a ticket: post the answer as a comment, close the issue, then append a one-line pointer to the map's Decisions-so-far section.
