# Deep: every function, one agent per branch

`/cybedefend deep` is the heavy audit. `/cybedefend` reviews every entry point. `/cybedefend deep` reviews every function behind them: a script lists each file, function and method of the repository as a tree, cuts the tree into branches, and one agent reviews each branch, several at once. Each function ends with a verdict in a ledger, so the audit can say what it read, and what it did not.

Use it for a release, for a repository that holds money or other people's data, or when `/cybedefend` came back clean and the user wants to go further. `/cybedefend` stays the command for every day.

**Say the cost before you start.** One agent per branch, each one reading about 2,000 lines and writing its tests: tens of minutes on a small service, an hour or more on a large one, and several times the tokens of `/cybedefend`. Give the user the numbers of step 2 ("214 files, 1,930 functions, 14 branches: 14 agents, 6 at a time"). More than 40 branches and someone at the screen: ask whether to review them all or the folders they name first. With nobody to answer, review them all.

The method does not change: the guarantees, the families of questions, the surface pages, the proof by a test, the format of a finding are those of [audit.md](audit.md) and [proofs.md](proofs.md). This page only says how the work is cut and counted. The rules of [SKILL.md](SKILL.md) hold for you and for every agent you start.

## 1. Scan, as usual

Step 1 of `/cybedefend` ([SKILL.md](SKILL.md)): `node <skill>/scripts/start.mjs`, its block shown to the user, the triage handed to a sub-agent in the background. Read no file of the repository before it has finished.

## 2. Build the tree

```bash
node <skill>/scripts/tree.mjs build
```

It lists the code files git sees and extracts every function and method (with universal-ctags when it is on the machine, with its own extractor otherwise: it installs nothing), and writes `.cybedefend/deep/tree.json`. Left out: documentation, lockfiles, vendored and generated code, tests, `.cybedefend/` and this skill. Each file also gets one line for the code outside any function (imports, settings, routes registered at the top, handlers with no name), counted like a function: nothing in a file escapes the review.

A branch is a folder, or a few small neighbours, or a part of a large folder: about 2,000 lines, and a file is never cut in two. `--branch-size 1200` makes smaller branches, for dense code. `--with-tests` adds the tests, when the user asks for them.

Show the user the block it prints, as it is: the counts, then the branches, each named after the folders it holds. The number "to review" is the one `status` follows. `.cybedefend/deep/` stays out of git by itself.

## 3. Map the entry points

Step 1 of [audit.md](audit.md), whole: every entry point in a row of `.cybedefend/audit/map.md`, the guarantees, the flows, the lines "Families:" and "Surfaces:", the roles. Leave the verdicts empty: the agents of step 4 give them. Then `node <skill>/scripts/cybedefend.mjs progress --of <rows>`.

The map is what makes a function's review mean something. An agent deep in a branch needs to know who can reach the function it reads, as which role, and which guarantee it must hold.

## 4. One agent per branch

Start one sub-agent in the background for each branch, with the brief below. Run as many at once as your harness allows, six at most unless the user gives another number, and start the next one each time one returns. Begin with the branches where a mistake costs the most: money, identity and sessions, rights and administration, other tenants' data, files.

Before you start a branch, `node <skill>/scripts/tree.mjs brief <branch> --ledger` writes its ledger with no verdict yet. Tell the user how many agents run and what each one covers.

> **The brief.** You review one branch of this repository in a deep security audit: every function of it, nothing else. Other agents review the other branches at the same time.
> 1. Read the method: `<skill>/audit.md` (steps 2 to 4: the questions, the proof, the format of a finding), `<skill>/proofs.md`, and these surface pages: `<the pages the map names>`. Read the map, `.cybedefend/audit/map.md`: the entry points, the guarantees, the flows, the roles.
> 2. `node <skill>/scripts/tree.mjs brief <branch>` lists your files and your functions, each with its id. Read each file once, whole, with its line numbers. A file the scan says holds a secret, and any settings or environment file, is read with `node <skill>/scripts/cybedefend.mjs show <file>`.
> 3. For each function: who calls it, from which entry point of the map, as which role, and which value in it comes from outside. Follow a call into another branch as far as you need to judge, and read there without giving verdicts there. Ask every question of the families and the surfaces that touch it. Compare it with its siblings: the function next to it that does the same on the same data with another check.
> 4. Prove each flaw with a test, as step 3 of `audit.md` says. All your tests go in files of your own, named `deep_<branch>`, in the place and the form `proofs.md` gives for the stack (the brief command prints the names): one file, or one per package where the stack wants a test next to the code it tests (Go). Write no other test file and change no shared fixture, no configuration and no application code. Run your own files only, never the whole suite: other agents are writing theirs. Say each flaw when its test fails for its reason: `node <skill>/scripts/cybedefend.mjs progress --flaw "<who does what, to whom>" --where <file:line>`.
> 5. Write your findings in `.cybedefend/deep/branches/<branch>.findings.json`, in the format of step 4 of `audit.md` (`{ "findings": [...] }`), leads included. Each finding has its own `title`, and a proven one its `attack` and its `impact`: they are what a person reads on the dashboard, so write them for someone who has never opened this code.
> 6. Give every function its verdict in `.cybedefend/deep/branches/<branch>.json`, under its id, as you go and never all at the end:
>    - `{ "verdict": "ok", "check": "..." }`: you read it whole. `check` names what protects it, with its file and line, or says in a few words why nothing in it needs protecting (it formats a date).
>    - `{ "verdict": "flaw", "finding": "<kind>@<file:line>" }`: a test of yours shows it. The kind and the place are those of the finding you wrote.
>    - `{ "verdict": "lead", "what": "..." }`: you think it breaks a guarantee and could not prove it.
>    - `{ "verdict": "not-reachable", "why": "..." }`: nothing calls it and no input from outside reaches it. Say what you searched.
>    - `{ "verdict": "not-examined", "why": "..." }`: you could not read it (it is generated when the project builds, it is a binary). Never for a function that looked dull.
> 7. `node <skill>/scripts/tree.mjs status <branch>` lists what has no verdict yet, and says what is wrong in a ledger it cannot read. You are done when your branch has none left.
> 8. Write only those files: your ledger, your findings file, your test files. Your last message is short: the rows of the map whose handler is in your files, each with its verdict as step 2 of `audit.md` writes it; how many functions, flaws and leads; and what crosses into another branch that its reviewer should know (a value you pass on unchecked, an object created here and read there).

Fill the two placeholders, and add under the brief the rows of the map whose handler is in the branch's files, so the agent knows which ones it answers for.

## 5. Follow the ledger

Each time an agent returns:

```bash
node <skill>/scripts/tree.mjs status
```

Its first line is the count to show the user, as it is: `Deep audit  ████████████░░░░░░░░  1164/1930 functions with a verdict, 8 of 14 branches complete, 5 flaws, 2 leads`. Then write the verdicts the agent returned into the map, and `node <skill>/scripts/cybedefend.mjs progress --reviewed <rows with a verdict so far>`.

- Exit 2: some functions have no verdict, and it lists them. A branch that came back with functions left goes to an agent again, a new one, with the same brief and the line "the ledger exists: review only what has no verdict yet". After two returns with the same functions left, give each of them `not-examined` yourself, with the reason, and say how many in the report.
- Exit 64: a ledger is not right, and it says what: a verdict that is not one of the five, an `ok` with no check, a `flaw` whose finding is not in the branch's findings file, an id that is not a function of the branch. Correct it, or hand it back to the branch's agent.
- Exit 0: every function has a verdict.

A run that stopped halfway starts again here: `status` says which branches are complete, and only the others go to an agent. After the code changed, build the tree again: the ids of the functions that moved no longer match, and `status` names them.

What crosses branches is yours. When two agents each report one half of a path (one passes a value on unchecked, the other trusts it), read that path yourself, end to end, and prove it or drop it. Your own proofs, here and in the coverage check of step 6, go in files of your own named `deep_coverage`, in the same form: never in a branch's file.

## 6. Merge, then check

1. `node <skill>/scripts/tree.mjs merge` gathers the findings of every branch into `.cybedefend/out/findings.json`. What is already there stays. The same flaw found by two branches (same file, same line, same kind) is counted once, and a proof wins over a lead. It says what it merged: repeat it in one line ("merge: 9 findings from 6 branches, 2 found twice"). More than five leads: keep the five strongest in the list, the others in the map as `lead` rows.
2. Run every proof yourself once, file by file, without its expected-failure mark: each test fails for the reason its finding gives. Then run the whole suite: it passes as before.
3. Every row of the map has its verdict. A row no branch answered for is yours to review now.
4. The two checks of [audit.md](audit.md), by agents that wrote none of this: the coverage check on the map, again until it returns nothing new, three times at most; and the challenge of each proof and each lead, the findings split between two or three challengers when there are more than eight. A proof that holds gets `"challenge": "holds"`. A broken one is corrected and challenged again, or goes back to a lead. A lead it refutes is dropped; one it calls provable gets its test. Two findings are merged only when one test shows both flaws: otherwise both stay, each with its test.
5. `node <skill>/scripts/cybedefend.mjs write-audit`, then steps 5 and 6 of [audit.md](audit.md): what is still true is kept, the map is saved and checked.

## 7. Finish and report

Steps 3 to 5 of `/cybedefend` ([SKILL.md](SKILL.md)): collect the triage, `node <skill>/scripts/cybedefend.mjs finish`, then the report of [report.md](report.md). Add to the report what only this command knows, from the last `tree.mjs status`: how many files, functions and branches were reviewed, how many functions are `ok`, `flaw`, `lead`, `not-reachable` and `not-examined`, how many agents ran, and the test files they added (one per branch that found something). Every number is counted from the files (`tree.mjs status`, the list of findings and their `challenge`), never from memory. Never say that every flaw was found: say what was read.

`/cybedefend deep` changes no application code. Fixing is `/cybedefend fix`, and each proof test is already there for it.

## With no sub-agents

The same steps, alone: take the branches one after the other, in the order of step 4, each with `tree.mjs brief <branch>` and the brief as your own checklist, the same ledger, the same test file per branch. Run `tree.mjs status` after each branch and show its first line. It takes longer: say so in step 2, and let the user pick the branches to start with. The checks of step 6 are then yours, done as [audit.md](audit.md) says for an agent with no sub-agent, and `challenge` is left out.

Adapted in part from the security-audit skill of Cloudflare, under the MIT License: see [NOTICE](NOTICE).
