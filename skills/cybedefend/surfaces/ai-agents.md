# Surface: AI agents and code that calls a model

Read this page when the map shows code that calls a model: a chat or an assistant, a search over documents that feeds a prompt (retrieval), an agent's memory, tools a model can call, an MCP server or client, a sub-agent, a prompt built from text that comes from outside, or model output that the code acts on. The flow to follow is always the same: **text from outside, into a model or a memory, out as an action, a query or a page.**

**What counts.**
- Persuasive text alone is not a finding. The finding is the code that lets it matter: the text reaches another user's context, triggers an action the requester could not do, discloses data they cannot read, or feeds a call they cannot reach directly.
- Model output, memory, tool descriptions and a tool server's answers are input, like a request body. Point to the line that grants authority, trusts the output, writes it to durable state or passes it to a dangerous call.
- An instruction in the system prompt ("never reveal", "only call the tool for the current user") is not a control. Count only what the code enforces: an authorization check on the resource, an isolation, a binding, a credential scoped to the user.
- A user who asks the agent to do what they may already do is using their own rights, even when a model carries it out. The flaw is when someone else's text causes it, or when the action goes beyond those rights.

## Context, retrieval and memory

- Who can write each source that enters a prompt: a document, an indexed page, an e-mail, an issue, a ticket, a file name, a tool's answer? Whose session reads it? A document a customer uploads that reaches a support agent's prompt with its tools is the classic path.
- Conversations, embeddings, retrieval results and prompt caches: is the tenant and the user in the query and in every cache key, on every path (search, batch, background job)? A tenant field stored on the record is no isolation if one query leaves it out.
- Memory: who may create, update, merge and delete it? Can a low-trust observation (a web page read, a tool answer) become a durable fact or instruction that steers a later task, another user or a more privileged session? Name both the write and the later read by someone else: memory a user saves for their own requests is not a flaw, nor is a shared record nothing reads.
- Prompt assembly: can text from outside pose as a system message, an earlier turn, a tool result or a policy? Look for string concatenation, a role field the caller sets, a history stored without its source.

## Tools and actions

- Each tool the model can call is an entry point. Its arguments come from the model, so from whoever wrote the text it read: follow each field to the database, the shell, the file system, the URL fetched. A JSON schema checks the shape, not the rights, the path or the address.
- The identity a tool acts with: a service account or a broad key, while the handler never checks that the requesting user may do this exact thing to this exact resource. If the user could not do it from the normal interface, the agent is a confused deputy.
- Approval: the user approves one described action, and the call that runs has other arguments, another target, another amount, another user, or runs again on a retry or a resumed session. The approval must bind the tool name, the full arguments, the requester, the target and an expiry.
- Text someone else wrote (an e-mail, a shared document) that makes the agent act under the victim's rights, when the victim never asked for that action: a flaw even when the victim may do it.
- A schema and a handler that read the same call differently: aliases, extra fields, duplicate keys, coercions, defaults. Check again where a value becomes a resource id or a security option.
- A request that queues spending, sending or changing in a loop, with no budget per request, no cancellation and no idempotency.

## Tool servers (MCP) and sub-agents

- A sub-agent or a tool server that receives the whole session, its credentials or its memory, where it needs one narrow right. What it returns is input again.
- Calls and answers routed by a name the other side chooses (server name, tool name, request id, resource address), and not by the authenticated connection and the pending request. Can two servers claim the same tool? Can an answer from one satisfy a call made to another?
- A tool server's descriptions, prompts and schemas guide the model and grant nothing. Find the allow list, the server identity check and the handler's own authorization that still decide when that metadata lies.

## Output

- Model output rendered as HTML or Markdown that loads images or links (a way to send data out), used as a command, a query, a path or a URL, with none of the encoding that call needs.
- A context that holds a credential, another user's data or a value that grants access, and a user who can make the model repeat it. Revealing the generic instructions is not a finding.

**Start from the end.** Draw four lists in the map: each identity the code acts with, each tool and what it can do, each place text can be written that a prompt or a memory later reads, and each place output goes. Then start at the tools that change something and walk back to the text that can choose their arguments, and at each memory read and walk back to every writer. Compare the direct, queued, retried, resumed and delegated paths to the same action.

**Prove it.** The model is a third party: the test replaces it with a stub that returns exactly what the attacker's text would make it return (the tool call with the other tenant's id, the output with the script). Then it calls the real handler, dispatcher or tool function, and asserts the guarantee: the other tenant's record is unchanged and the call is refused, the approval does not cover the changed arguments, the memory written by one user is not read for another. No call to a real model, no API key.

**Kinds:** `prompt-injection`, `model-output-trusted`, `tool-with-excess-rights`, `confused-deputy`, `action-not-bound-to-approval`, `memory-poisoning`, `context-shared-between-users`, `tool-peer-trusted`, `unbounded-resource-use`, `ssrf`, `sensitive-data-exposure`.

Adapted in part from the security-audit skill of Cloudflare, under the MIT License: see [NOTICE](../NOTICE).
