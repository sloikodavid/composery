# Vocabulary

The words that code, copy, and docs use for one meaning each. AGENTS.md holds the rules; this file holds the words those rules choose. Change it in the same commit as the code, and add a concept before using it. [The session that set this vocabulary](sessions/2026-09-14-claude-vocabulary.md) shows the reasoning and back and forth behind most of these choices, and explains how to think about structure and naming things in the repo.

## Domain nouns

| Word | Meaning | Not |
|---|---|---|
| `user` | A person with a Clerk account, synced to `users` | account (except in copy for the person's own settings) |
| `server` | What a user owns and shares. Never a thing at a provider | machine, vm, instance |
| `name` | A server's DNS-safe label. There is no separate display name | slug, display name |
| `claim` | A permanent association of a name with one server | reservation |
| `membership` | Another user's access to one server, with its permissions | member (for the row) |
| `member` | The user in a membership | |
| `owner` | The one user who owns a server and holds every permission. The owner has no membership | |
| `permission` | One platform authority on a server, such as `rename` or `power` | role, right |
| `quota` | How many of one kind of thing a user, or the whole deployment, may hold. An admin sets it, and billing sets it later | grant, allowance |
| `limit` | A fixed cap in the code, such as members for one server | |
| `unknown` | What a report about another system cannot establish, stated with the report | limit, caveat |
| `rate limit` | How often one account may do something | throttle |
| `snapshot` | A copy of one server's disk, held by the provider, that another server can be made from | image (which is what a server is created from), backup |
| `allocation` | One real instance of a server: what currently runs it, for its lifetime | provisioning, incarnation |
| `operation` | A recorded command on a server: `create`, `start`, `stop`, `forceStop`, `delete` | command, job |
| `backend` | The mechanism that makes an allocation real, such as `hetznerCloud` | version, v1, v2 |
| `provider` | The company and API that a backend calls, such as Hetzner | vendor |
| `resource` | One thing that a backend owns at its provider | |
| `finding` | Evidence about an unknown resource, for admin review | alert |
| `epoch` | The number of a worker's attempt at an allocation, which fences writes from an older attempt | generation, version |
| `lease` | A worker's claim on one allocation for a time, so two runs never act at once | lock |
| `reply` | What an outside system sends back to one request of ours | response |
| `problem` | One way a value disagreed with what a description says about it | violation, error (which is ours) |
| `pin` | A version, day, or digest written down so that a run is the same tomorrow | lock, freeze |
| `digest` | The fixed-length value that names some bytes, such as SHA-256 of a file or a key | hash, checksum |
| `contract` | What an outside system publishes about itself, such as an API description, and what we hold our own requests and our fakes to | schema, spec |
| `waiver` | A named exception to a contract, with the evidence that the system disagrees with its own description, which fails when it stops being needed | ignore, override |
| `SSH access` | Composery's management key and the server's pinned host key for one allocation | credential |
| `envelope` | One stored secret as it is written down: the version, the key that encrypted it, and the encrypted bytes | blob, ciphertext |
| `secret` | A value that must stay private, such as a private key or a token | credential |
| `bootstrap` | The window after creation in which a new server reports its host key once | enrollment |
| `admin` | A person on the Composery team who uses the Convex dashboard or CLI | operator |
| `failure` | An expected result that a function returns, with a code | |
| `error` | A result that a function throws, with a code | exception (in copy) |
| `key pair` | A private key and its public key | credential |
| `management key` | The key pair that Composery uses to sign in to an allocation | |
| `pending key pair` | The management key that a renewal installs, which takes over when the server reports with it | new key |
| `script` | Program text that runs on a server, whether Composery sends it or a person runs it | command (which is an `operation`) |
| `authorized key` | One entry in an `authorized_keys` file: options, a public key, and a comment | credential, SSH key (in code) |
| `edit` | One change to one file's contents, planned against the revision it was read at | change, patch |
| `revision` | What a file held when it was read, named by a digest of those bytes | version |
| `acceptance` | Whether the running SSH server lets a public key sign in to an account, as it answers Composery's address | probe, validity |
| `host key` | The key pair that identifies a server to SSH clients | fingerprint (for the key itself) |
| `host key conflict` | A second, different host key reported for one allocation after its host key was pinned | |
| `harness` | Test code that starts, isolates, and stops what tests need, such as an SSH server or a Convex backend | fixture |
| `fake` | A working, simplified copy of another system that tests run instead of it, in the sense the xUnit test patterns give the word. It may be told what to answer for one request, and it never decides whether a test passes | mock, stub, stand-in |
| `live test` | A test that reaches the real outside system, costs money or quota, and never runs from plain `bun test` | lane, smoke test |

## Verbs

| Words | Meaning |
|---|---|
| `create` / `delete` | A record or resource starts or stops existing |
| `add` / `remove` | An item enters or leaves a collection that continues to exist, such as a member or a key line |
| `reserve` / `release` | Capacity is held or given back |
| `start` / `stop` | Power |
| `request` | Record intent that a worker completes later: `requestPower`, `requestDelete` |
| `store` | Create or replace a record |
| `sync` / `reconcile` | Copy one record from another system / compare all records and repair differences |
| `enqueue` | Put one run of work in a work pool |
| `sweep` | Enqueue the work that is due |
| `wake` | Make an allocation's work due now |
| `record` | Store the outcome of a run of work |
| `finish` | Do the last step after a backend confirms that its work is complete |
| `claim` | Take a lease on work, or permanently associate a name. The file says which |
| `encrypt` / `decrypt` | Protect or read a stored secret |
| `register` | Record a fact that another system reports, such as a host key |
| `discover` | Ask another system what its state is, instead of assuming it |
| `observe` | Read an allocation's state at its provider and write down what it said |
| `update` | Change part of something that keeps its identity, such as one line of a file |
| `renew` | Make an expired thing valid again, such as a bootstrap window |
| `generate` | Make new random secret material, such as a key pair or a token |
| `transfer` | Move ownership, and the quota that it uses, to another user |

JavaScript reserves `delete`, so a registered Convex function that deletes is named `remove`.

## Name prefixes

| Prefix | Returns |
|---|---|
| `is`, `has`, `can` | A boolean |
| `get` | One item, or `null` |
| `list` | Many items |
| `find` | An item that a search can miss, or `null` |
| `require` | A value, or throws. Where there is no value to return, it throws unless what it names is true |
| `check` | A failure, or `null` |
| `set` | Nothing; replaces a value |
| `to` | A converted value |
| `render` | Text in an external format |
| `call` | The response of an external call |

## Status words

A command is a verb (`create`), its progress adds `-ing` (`creating`), and its outcome describes the result (`running`, `stopped`, `deleted`). Operation outcomes are `pending`, `succeeded`, `blocked`, and `superseded`. Whether a resource exists is `pending`, `uncertain`, `present`, or `absent`. All of these are `status`, never `state` or `phase`.

## External words

A provider's words stay in the files named for that provider. Hetzner's `server`, `primary_ip`, and `off` appear only in `convex/allocations/hetzner_cloud/`; everywhere else the words are `allocation`, `ipv4`, `ipv6`, and `stopped`.
