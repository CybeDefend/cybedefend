# Surface: APIs beyond REST, webhooks and queues

Read this page when the repository uses GraphQL, gRPC or another RPC, Protobuf or another binary format, streaming, webhooks, a broker or a queue (Kafka, RabbitMQ, SQS, Redis streams, Pub/Sub, a job queue), or an event bus. The questions here are about who sent a message, how it is read, where it is routed, and what happens when it comes twice, late or out of order.

**What counts.**
- "Internal" is not authentication. Name the identity at each hop, and show how it becomes the user or tenant the handler authorizes.
- A schema checks the shape of a message, not who sent it, which resource it may touch, its order or its values. Follow each decoded field to the decision and the change it drives.
- The broker's guarantees and the code's are different things. Write down, for the message family, how retry, order, acknowledgement and deduplication work before you judge what a duplicate does.
- A broker permission or a service-mesh identity that is not in the repository is unknown: the flaw is a lead that names it.

## Who sent it

- A webhook or a provider's notification (payment, sign-in, source control, chat) acted on with no signature check, a signature checked on a re-serialized body and not the bytes received, or a check that a missing header skips.
- A message whose body says it is an admin event, a provider callback, a replication record or a migration step, trusted without a producer identity the code can verify.
- A channel authenticated as a service (mTLS, a workload identity, a broker credential) while a field in the message chooses the user or the tenant the handler acts for.

## How it is read

- Two consumers, two versions of a schema or two languages that decode the same message differently: duplicate fields, unknown fields, an enum value one side does not know, a default of zero that means "admin" or "all", compression, numeric width. Name the field and the two readings. When either side refuses the message, there is no flaw.
- An envelope or routing key that the authorization reads, and a body that names another tenant, account or object that the handler acts on. Which one is the truth, and can the caller set the other?

## Rights on every path

- GraphQL: each resolver authorizes its own object, including nested fields and connections reached from an object the caller may see; mutations and subscriptions as well as queries; introspection and batching do not open what single queries close; depth, breadth and aliases have a bound.
- gRPC: the interceptor that checks rights covers unary calls and streams, reflection, health, and the routes a gateway transcodes from REST.
- A stream, subscription or batch authorized once, whose later items name other resources, or that keeps delivering after the member is removed or the token is revoked.
- A reply, a cancellation or an acknowledgement matched to its request by an id the caller can guess or reuse, so it completes someone else's operation.
- A topic, routing key, consumer group or reply queue built from a value the caller chooses, so they publish to or read another tenant's messages. A tenant written inside the payload is no isolation.
- Dead-letter queues, error topics and traces that keep secrets or another tenant's payloads where a lower-trust reader looks.

## Twice, late, out of order

- A message delivered again (retry, redelivery, a webhook resent) that repeats a payment, an e-mail, a credit or a grant: no deduplication, a deduplication after the change, or a key shared across tenants or operations.
- An old message (a revoked membership, a cancelled job, a state from before a step-up) that arrives after a newer one and overwrites it: no version, sequence or timestamp check.
- Acknowledged before the change is stored (work lost), or stored before an acknowledgement that may fail (the change runs twice).
- One business change split across several consumers, where a failure in the middle leaves half of it applied.
- One message that always fails and is retried for ever at the head of a queue or a partition other tenants share: nothing sets it aside, so their messages wait behind it.

**Follow each message family.** Producer, transport, gateway, consumer, storage: at each hop, write who is authenticated, which fields decide the tenant and the resource, what is validated, and what changes. Compare the normal path with retry, dead letter, replay, migration, reflection and the gateway's routes.

**Prove it.** Call the real consumer, resolver or handler in the test process with the forged message (unsigned, another tenant in the body, the same id twice, an old version after a new one), using the repository's own in-memory transport or test server. Assert the guarantee: the payment is credited once, the other tenant's data is untouched, the unsigned notification changes nothing. No real broker, no provider.

**Kinds:** `message-sender-not-verified`, `signature-not-verified`, `message-replay-accepted`, `missing-idempotency`, `missing-object-authorization`, `cross-tenant-reference`, `missing-tenant-filter`, `rights-kept-after-removal`, `unprotected-alternate-path`, `third-party-data-trusted`, `predictable-token`, `sensitive-data-exposure`, `unbounded-resource-use`, `unhandled-input`.

Adapted in part from the security-audit skill of Cloudflare, under the MIT License: see [NOTICE](../NOTICE).
