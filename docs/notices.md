# Notices

Not built. This exists because several parts of the system already produce states that need a person, and none of them can reach one. Each of those parts would otherwise have to describe the gap itself, which is how the same sentence ends up in four documents.

A **notice** is a statement that a state needs someone's attention, addressed to whoever can act on it. The channel is an attribute of a notice, not a different kind of thing: the same fact can appear in the panel and arrive as an email. That is why there is one word here rather than three. `notification` and `alert` say the same thing with more letters or more urgency baked in, and a word that already implies urgency is the wrong one for "your server's SSH is unavailable, which may be what you intended".

## What already needs one

Every row here exists in the code today, is recorded, and reaches nobody.

| State | Who can act | What they would do |
|---|---|---|
| An allocation is `blocked` | admin | read the recorded error, fix the difference at the provider, or retry it |
| An allocation is `missing` | admin | establish whether the server is really gone |
| A `hetznerCloudFindings` row: a resource at the provider that Composery does not own | admin | decide whether it is ours, and remove it by hand if not |
| A stored secret names an encryption key the deployment no longer holds | admin | put the key back in `SSH_ACCESS_ENCRYPTION_KEYS` |
| An operation is `blocked` | customer, then admin | know that the thing they asked for did not happen |
| Composery's SSH access to a server no longer works | customer | put the key back, or tell us it was on purpose |
| A quota is exhausted, for a user or the whole deployment | customer, admin | ask for more, or stop trying |
| `reconcile` fails against Clerk | admin | Clerk is unreachable, and accounts are drifting |
| A pinned contract moved: a vendor changed its published description | admin | read the difference and decide |

The last one is different from the rest: it is about the repository rather than a running server, so it belongs in whatever runs on a schedule outside the deployment. The others are about state the deployment holds, and belong to the deployment.

## Why this is not optional

`docs/policy.md` says a failure must leave the system in a state a person can act on. A state that is recorded and never surfaced meets the letter of that and misses the point: nobody is acting on anything they have not been told.

It is also what makes the rest of the policy affordable. "No repair feature is owed" is only reasonable while somebody finds out in time to repair it by hand.

## What is not decided

- **Whether customers get any of this before release.** The admin rows are the ones that make the system operable; the customer rows are product.
- **Channels.** In-panel is the cheap one and needs no new service. Email needs a sender and a template, and a customer who has removed our key on purpose should probably not be emailed about it repeatedly.
- **Whether a notice is a record or a derivation.** Every row above can be computed from state we already hold, which argues against a table; a notice somebody has dismissed or acted on cannot, which argues for one.
- **Grouping and rate.** One server flapping must not produce one notice per sweep.

Nothing here should be built before the shape of the panel is known, because the panel is where most of it lands.
