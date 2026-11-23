# Proof tests, stack by stack

Read this when you write the first proof test of an audit ([audit.md](audit.md), step 3). Two rules hold on every stack:

- **The suite stays green until the fix.** The proof carries the framework's expected-failure mark, or stays out of the default run when the framework has none.
- **You have seen it fail for its reason.** Run each proof once without its mark and read the message: it is your assertion, never an import, a fixture or a type error.

A switch in the test file gives you both. Read the mark from the environment, so `CYBEDEFEND_RAW=1` runs the proofs bare and nothing has to be edited by hand. Write the two commands at the top of the file, the marked run and the raw one: the developer who fixes the flaw will use them.

**Write each test file whole, in one go**, its header with the two commands included: patching a file afterwards with `sed -i` fails on macOS, and costs a run.

**Where the proofs go.** In a `tests/security/` folder next to the application's tests (`test/security/` when the repository says `test/`; next to the application's code, as `app/tests/security/`, when it has no unit tests), or in files named `test_security_*` (Python), `*.security.test.*` (JavaScript, TypeScript), `*_security_test.go` (Go), `*security_spec.rb` (Ruby). The scanners skip those paths: a proof holds attack inputs and test passwords on purpose, and they would only add noise.

**`proofTest` names the test and nothing else**: its file and its name, as the examples of [audit.md](audit.md) write them. A flag or a variable the proof needs to run (Go's `-race`, an environment variable) goes in the comment above the test, with the whole command. A race is proven by a test that runs the two calls at once and asserts the guarantee (the balance, the count), so that it fails on its own assertion; when only the race detector shows it, that comment gives the command with `-race`.

**Nothing new in the project.** A proof adds no dependency to the project's manifest and installs nothing on the machine. When the repository has no test runner, use one that needs no install (Python's `unittest`, `node --test`, Go's `testing`) or a pinned one in a throwaway environment (`uv run --no-project --with ...`, `npx --yes <runner>@<exact version>`). The project's own dependencies, installed in the project the way its README says (`npm ci`, `uv sync`, `go mod download`), are fine when the suite needs them.

## Python

pytest:

```python
import pytest

@pytest.mark.xfail(strict=True, reason="cybedefend-audit audit/missing-object-authorization")
def test_security_member_cannot_read_other_org_invoice(client):
    ...
```

Raw run: `pytest --runxfail tests/security/test_security_invoices.py`. `strict=True` turns the test red the day the flaw is fixed, which tells the fix to remove the mark.

unittest has no flag to ignore the mark, so read it from the environment:

```python
import os, unittest

# CYBEDEFEND_RAW=1 python -m unittest tests/security/test_security_billing.py  -> each proof fails on its own assertion
proof = (lambda test: test) if os.environ.get("CYBEDEFEND_RAW") else unittest.expectedFailure

class SecurityProofs(unittest.TestCase):
    @proof
    def test_security_refund_never_exceeds_the_payment(self):
        ...
```

- No test suite: create `tests/security/`, with a fixture that builds the app the way its entry file does, without starting a server, and the app's files (databases, key files) in the test's own temporary folder.
- Dependencies that are not pinned: a recent version can break the app for a reason of its own. Pin what the code was written for, in a throwaway environment (`uv run --no-project --with 'flask<2.3' --with pytest pytest ...`), and write that command at the top of the test file.
- A framework's test client can replace what you forge (a hand-written `Cookie` header replaced by the client's own jar): set it through the client's API, the one of the version you pinned (`set_cookie(key, value)` from Werkzeug 2.3, `set_cookie(server_name, key, value)` before).
- An entry file that starts the server when it is imported (`app.run(...)` at the top level): make the framework's `run` do nothing before the import (`monkeypatch.setattr(flask.Flask, "run", lambda *a, **k: None)`), and import the file from a temporary folder that holds copies of the files it reads.
- A setup request that answers 500 hides its cause behind the test client: read the traceback (the app's `PROPAGATE_EXCEPTIONS` setting, or the raw output) before you doubt the proof.

## JavaScript and TypeScript

Vitest and Jest:

```ts
import { it, expect } from 'vitest';

// CYBEDEFEND_RAW=1 runs the proofs without their mark.
const proof = process.env.CYBEDEFEND_RAW ? it : it.fails; // Jest: it.failing

proof('test_security_member_cannot_update_another_users_task', async () => {
  ...
});
```

- No runner installed: `npx --yes vitest@<exact version> run --root <app folder> --config tests/security/vitest.config.ts`, nothing added to `package.json`. The config is a plain object (`export default { test: { include: [...] }, css: { postcss: { plugins: [] } } }`): importing `vitest/config` fails when Vitest is not a dependency, and Vite would otherwise load the app's PostCSS plugins.
- No dependency at all: `node:test` with `node:assert`, run by file (`node --test tests/security/checkout.security.test.js`; a folder path fails on recent Node versions). It has no expected-failure mark of its own, and its `todo` option stays quiet the day the proof passes, so wrap the proofs:

  ```js
  import { test } from 'node:test';

  // A proof fails until the fix: the run stays green, and turns red the day the proof passes.
  // CYBEDEFEND_RAW=1 runs the proofs bare.
  const proof = (name, fn) =>
    test(name, async (t) => {
      if (process.env.CYBEDEFEND_RAW) return fn(t);
      try {
        await fn(t);
      } catch {
        return;
      }
      throw new Error(`${name} passes now: the flaw is fixed, remove this proof's mark`);
    });
  ```

  TypeScript handlers run under `node --test` through the loader the repository already uses (`tsx`, `ts-node`), or a recent Node's own type stripping. Generated or uninstalled modules are pointed at stand-ins with a resolve hook, which is also where a missing `.ts` extension is added:

  ```js
  // tests/security/register.mjs, passed with: node --import ./tests/security/register.mjs --test <file>
  import { register } from 'node:module';
  register('./hooks.mjs', import.meta.url);

  // tests/security/hooks.mjs: what is outside the code under test, and nothing else
  import { existsSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  const STUBS = {
    'wasp/server': 'export class HttpError extends Error { constructor(status, message) { super(message); this.statusCode = status; } }',
    openai: 'export default class OpenAI { constructor() { this.chat = { completions: { create: async () => globalThis.__openai() } }; } }',
  };
  export async function resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: `stub:${specifier}`, shortCircuit: true };
    // A relative import written without its extension.
    if (/^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier) && context.parentURL?.startsWith('file:')) {
      const file = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(file))) return { url: file.href, shortCircuit: true };
    }
    return next(specifier, context);
  }
  export async function load(url, context, next) {
    if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice('stub:'.length)], shortCircuit: true };
    return next(url, context);
  }
  ```

  A module imported for its types alone still loads unless the import says `type`: give it an empty stand-in (for a framework's generated package, one rule for every `wasp/...` it imports). A file that imports a type as if it were a value fails with "does not provide an export named": add an empty export of that name to the source the load hook returns, which changes nothing the proof is about. Run TypeScript with `node --experimental-transform-types --test` from the first run: a file with an `enum` fails under plain type stripping, and the flag costs nothing when there is none. A module that reads its configuration when it loads needs dummy values in the test's environment.
- Code that imports generated modules (a framework's server package, a generated client): import the handler itself and point the generated import at a small stub, with the runner's alias setting. Give the handler a context whose database object is a small in-memory stand-in that applies the filters it receives (`where`, `data`, increments), so a query without the owner filter really returns the other user's row.
- Code that imports packages nobody installed: when the repository has a lockfile, install its dependencies the way its README says, and use them. When it cannot be done, point those packages at a stand-in with the runner's alias setting (one pattern for all of them, shared mocks in a setup file). Never replace the code the proof is about: the guard, the handler, the query it builds.
- A route registered without its guard (the handler is fine, the line that mounts it forgot the middleware): prove it on the framework's own route table. Build the router, find the route, and assert that its guard is among its handlers; or call it through the framework's test client when the application can be built without starting a server.

## Go

Go has no expected-failure mark, so a proof stays out of the default run in one of two ways. Take the one the repository's own tests point to.

**The repository tests its handlers from inside the package** (a helper that builds the server with unexported fields, such as `newTestServer`): write the proofs the same way, in a file named `*_security_test.go` next to them, each starting with a skip.

```go
// CYBEDEFEND_RAW=1 go test ./api/ -run TestSecurity_ -count=1   each proof fails on its own assertion
// go test ./api/                                               the proofs are skipped, the suite is as it was
func TestSecurity_member_cannot_delete_other_users_account(t *testing.T) {
	if os.Getenv("CYBEDEFEND_RAW") == "" {
		t.Skip("proof of an open finding: CYBEDEFEND_RAW=1 runs it")
	}
	...
}
```

**The application exports what a proof needs** (constructors, a module): a package of its own under `.cybedefend/audit/tests/`, which `go test ./...` skips because the folder's name starts with a dot, run by path (`go test ./.cybedefend/audit/tests/ -count=1`). Build the server from the exported constructors or modules. With a dependency-injection container (`fx`, `wire`), take the router from the application's own module (`fx.Populate(&handler)`), never a router wired again by hand: the proof must go through the routes as the application registers them. With the fix, that test moves next to the code it protects, as an external test package in the same folder (`package api_test` in `api/`); a path it wrote relative to its old folder changes with the move.

- When the repository has no mock of the store, a struct that embeds the store's interface and defines only the methods the handler calls is enough. Give it recorders (what was deleted, what was transferred) to assert that the store was not called. A method you did not define panics: the handler went further than you thought, and you read why.
- A handler that panics on the input: `recover` in the test and assert that no panic happened.
- With the fix, a skipped proof loses its skip and becomes a test of the suite.

## Ruby

RSpec: `pending("cybedefend-audit audit/<kind>") unless ENV["CYBEDEFEND_RAW"]` as the first line of the example. A pending example runs and must fail; RSpec turns it red the day it passes.

## Other stacks

The two rules at the top, with the tools of the stack. JUnit 5 has no expected-failure mark: run the test raw, read its failure, then mark it `@Disabled("cybedefend-audit audit/<kind>: fails until the fix")`, and the fix removes the mark. When the stack offers neither a mark nor a way to keep a test out of the default run, keep the proof in `.cybedefend/audit/tests/` with the command that runs it.

## A suite that was already red

Run the suite once before you add anything. Tests that fail before your first proof are the repository's own: leave them as they are, write their names in the map under "Baseline", and say in the report that they failed before the audit. When one of them fails because of a flaw you found, the finding still gets its own proof, and its message says that a test of the repository already fails for it.
