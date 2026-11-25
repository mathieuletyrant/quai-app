# Coding standards

The rules of this repo are in `AGENTS.md` (and the `AGENTS.md` nearest a changed file), `GLOSSARY.md` and
`docs/adr/`. This file says how a reviewer, human or AI, applies them.

## Reviewing a diff

1. Read the title and the description: they are the spec.
2. Read the diff, then the whole file around each hunk, then the callers of what changed.
3. Apply every rule of `AGENTS.md` that touches a changed file, including "Tests" and "Before finishing a task"
   (`openapi.json` regenerated, `llms.txt` and the README's settings table updated).
4. Run each finding through "Before you flag".

## Before you flag

A finding that matches one of these is dropped.

- **Intent.** Behaviour the description, an issue or an ADR asks for is the spec, not a bug.
- **Premise.** A claim about a library (Effect, the *arr APIs, React) is checked against the installed version's
  source (`node_modules/<pkg>`) or a recorded fixture first.
- **Path.** A finding about an impossible-looking state names the caller or input that reaches it.
- **Scope.** A gap the diff does not touch is pre-existing. Code the diff leaves behaviourally as it was is not renamed,
  extracted or deleted by this PR.
- **Tooling.** What `tsc` or the formatter reports on its own is no finding.
- **Accepted risk.** A race or a ceiling recorded in an ADR or a `ponytail:` comment stays, unless one conditional write
  closes it.

A security finding stays a finding even when an earlier reply waved the same class away.

## Comments

`AGENTS.md`'s "Code" section is the rule: a comment carries what the code can't (why, a service's quirk, a unit, a
gotcha), and an export keeps its one-line doc. A comment that only restates the code or the name next to it is a
finding, quoting both.
