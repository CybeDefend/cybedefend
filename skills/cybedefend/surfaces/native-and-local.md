# Surface: native code, desktop, mobile and local services

Read this page when the repository holds a desktop or mobile application (Electron, Tauri, React Native, Flutter, Swift, Kotlin), deep links or a custom URL scheme, a web view with a bridge to native code, a local daemon, socket or helper that runs with more rights than its caller, exported Android components, XPC, D-Bus or named pipes; or native code that parses input (C, C++, `unsafe` Rust, Go with `unsafe` or cgo, a native module of a Node or Python package).

**What counts.**
- Name the realistic attacker: another application, another user of the machine, a web page in the web view, a document the user opens, a remote origin. A user harming their own account with their own rights crosses no boundary.
- A path, a process name, a bundle id or a sender field written in the message is not who the caller is. Count only what the system proves: the peer's credentials, its code signature, a capability handle.
- A bridge or a helper authorizes each operation, and the final resource, after it parses the arguments. A trusted window or broker in between does not make the arguments trusted.
- A crash proves a memory flaw only when input from outside reaches it. Do not jump from a crash to code execution, or from a label to memory corruption.
- Signing, entitlements, manifests and the OS version are unknown when the repository does not pin them: the flaw is a lead that names them.

## Deep links and handoffs

- A custom scheme or app link that starts a sensitive action (sign in, pay, change a setting, open a file, call an API with the user's token) with nothing that checks the link's origin or asks the user. Two apps that can claim the same scheme.
- A sign-in or payment callback delivered to the app by a link that another app can send, or whose `state` is not tied to the request the app made.
- A file, share or intent received from another app and opened with the app's own rights: a path outside the app's folder, a content URI the app then reads for the sender.

## Web views and bridges

- A bridge object (`addJavascriptInterface`, a `postMessage` handler, Electron `ipcMain`, Tauri commands, a JavaScript channel) exposed to every page the web view may load, including a third-party page, an ad or a redirect.
- Bridge functions wider than the feature: read any file, run a command, open any URL in the system browser with a token, change a setting.
- Electron and similar: `nodeIntegration` on, `contextIsolation` off, `sandbox` off, a `preload` that hands out `ipcRenderer` or `require`, `shell.openExternal` with a URL from the page, navigation to remote content not blocked.
- A web view allowed to read local files or every origin (`allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs`).

## Local services and exported components

- A local socket, port, pipe, XPC service or D-Bus interface that acts for any process that connects, with no check of who it is. A localhost HTTP server any web page can reach.
- The caller's claimed identity (a user id in the message) used in place of the identity the channel proves.
- Android components exported (`exported="true"`, an intent filter) that change state or return data with no permission; a content provider that serves any path; a broadcast with private data any app can receive.
- A privileged helper or installer that does what an unprivileged caller asks with arguments it never checks: write this path, run this file, change this owner. A file checked and then used by name (time of check to time of use), a temporary file in a shared folder, an update or repair step that runs a file a normal user can replace.
- Secrets in plain files, shared preferences or logs where another app or user can read them, when the system keychain exists.

## Memory and integers (native code that parses input)

- A length, index or offset from the input used to read or write a buffer, with the check missing, done on a different value, or done before an addition that overflows. Every caller of the function, not only the one the test uses.
- An integer that wraps, truncates when cast to a smaller type, or changes sign, and then sizes an allocation or a copy.
- Memory used after it is freed, freed twice, or kept as a view after the buffer behind it moved. Shared state read and written by two threads without a lock.
- An FFI boundary where one side passes a pointer and a length, and the other trusts the length; layouts or enums that differ between the two sides.

**Start from the privileged side.** List what each bridge, helper, service and exported component can do, then walk back to every caller that can reach it, and check what the code proves about that caller and its arguments at the last moment before the action.

**Prove it.** The repository's own unit tests, or a minimal harness in its test folder: call the bridge function with the page's arguments and assert it refuses; send the intent or the message as another app would (Robolectric, an XCTest, an in-process call) and assert nothing changed; feed the parser the input with sanitizers on (`-fsanitize=address,undefined`, `cargo test` with Miri where the project uses it) or the project's existing fuzz target, and stop at the first report. No device of a real user, no work past the first proof.

**Kinds:** `deep-link-trusted`, `native-bridge-exposed`, `local-caller-not-verified`, `memory-corruption`, `integer-overflow`, `insecure-default`, `race-condition`, `path-traversal`, `command-injection`, `third-party-sign-in-not-bound`.

Adapted in part from the security-audit skill of Cloudflare, under the MIT License: see [NOTICE](../NOTICE).
