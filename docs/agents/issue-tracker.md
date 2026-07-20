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
child_id=$(gh api repos/orphic-inc/stellar-api/issues/<child> --jq '.id')
gh api -X POST repos/orphic-inc/stellar-api/issues/<map>/sub_issues -F sub_issue_id="$child_id"
```

**Blocking** uses the native dependency relationship, which renders the frontier visually in GitHub's own UI. Same integer-`id` rule:

```bash
blocker_id=$(gh api repos/orphic-inc/stellar-api/issues/<blocker> --jq '.id')
gh api -X POST repos/orphic-inc/stellar-api/issues/<blocked>/dependencies/blocked_by -F issue_id="$blocker_id"
```

**No trailing slash on the id lookup.** `issues/<n>/` returns a 404, so an unguarded `$(...)` leaves the id empty and the `-F` that follows fails on a blank value — the relationship silently never forms. Guard the lookup (`|| exit`) rather than trusting it, and read the relationship back to confirm it landed.

Both recipes work cross-repo: swap the `repos/<owner>/<repo>` segment to file a dependency on `orphic-inc/stellar-ui`.

Read an issue's blockers with `gh api repos/orphic-inc/stellar-api/issues/<n>/dependencies/blocked_by --jq '[.[].number]'`.

**Claiming** a ticket is assigning it: `gh issue edit <n> --add-assignee obrien-k`. An open, unassigned ticket is unclaimed.

**The frontier** is the map's open children that are unassigned and whose blockers are **all closed** — not the ones with an empty `blocked_by` list. `blocked_by` keeps listing a blocker after it closes, so an empty list means "never had one", and testing for emptiness reports a frontier of nothing the moment a map starts resolving tickets. Filter on blocker _state_, not list length.

There is no single query for this — list the children, then check each one's dependencies:

```bash
REPO=orphic-inc/stellar-api
if ! children=$(gh api repos/$REPO/issues/<map>/sub_issues \
    --jq '.[] | select(.state=="open") | .number' 2>/dev/null); then
  echo "could not list children — retry"
else
  printf '%s\n' "$children" | while read -r n; do
    [ -z "$n" ] && continue
    if ! blockers=$(gh api repos/$REPO/issues/$n/dependencies/blocked_by \
        --jq '[.[] | select(.state=="open") | .number] | join(",")' 2>/dev/null); then
      echo "#$n UNKNOWN — request failed, retry"
    elif [ -z "$blockers" ]; then
      echo "#$n FRONTIER"
    else
      echo "#$n blocked by $blockers"
    fi
  done
fi
```

Iterate with `while read`, not `for n in $children`. Word splitting differs between the shells this gets pasted into: zsh does **not** split an unquoted `$children`, so a `for` loop runs once with all the numbers glued into a single value, while bash splits it as intended. (zsh _does_ split unquoted `$(...)`, so `for n in $(gh api …)` fails the opposite way — it shreds an error message into fake issue numbers.) Reading line by line is correct in both.

**Both** exit-status guards are load-bearing, because this endpoint family 503s intermittently and every unchecked call fails in a way that looks like data:

- Unchecked **inner** call — the error JSON lands in `$blockers` and reports as a bogus blocker, or as a phantom FRONTIER depending on how the filter is written.
- Unchecked **outer** call — worse. The error text word-splits in the `for`, so each word becomes a fake issue number and you get a screenful of confident output about tickets that do not exist.

Unknown is a third state, distinct from blocked and unblocked. A frontier reading with any UNKNOWN in it is incomplete — retry before acting on it.

**Resolving** a ticket: post the answer as a comment, close the issue, then append a one-line pointer to the map's Decisions-so-far section.
