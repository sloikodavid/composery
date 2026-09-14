 ▐▛███▛█   Claude Code v2.1.270
▝▜██████▀  Opus 5 · Claude Pro
  ▝▝ ▝▝    ~\Documents\Projects\composery


❯ /clear                                                                        

❯ What do you think about renaming our names funnel and everything, like on it, 
  in it, like the constants and stuff, constants and stuff, and then, yeah,     
  just combing through, like, the rest of the repository and making sure that   
  things are named aptly, and then organizing all of the server stuff properly  
  within maybe, like a server or servers type of directory inside of Converge,  
  similar to how we organize all the SSH stuff. And then it's actually          
  interesting because the SSH folder actually contains the files without, like, 
  the SSH prefix. So possibly all of the files would have to be renamed as      
  well, maybe. Or maybe just the SSH files would have to be renamed. What do    
  you think? Where can we go from here? And keep in mind an agent is also       
  editing in parallel, but that shouldn't disrupt your thought process or       
  execution willingness at all.  The thing that I would hate the most is        
  asymmetry, or if you, like, decided to overfit to my prompt and then not      
  generalize to, for example, not just the file names but the constant names,   
  the API names, and everything internal, like references and stuff like that.  
  I need proper, perfect symmetry and organization so that we know what         
  different stuff does and where it is, and it's not just messy. Let me know if 
  you think that we should keep the current shape as is, like verbatim.         

● Bash(git ls-files convex src app lib components scripts docs 2>/dev/null |
      grep -v _generated | head -200; echo ---; git status --short; ls convex
      convex/ssh)
  ⎿  convex/auth.config.ts
     convex/convex.config.ts
     convex/crons.ts
     … +133 lines (ctrl+o to expand)

● Bash(cd convex && wc -l *.ts ssh/*.ts && cat names.ts limits.ts && cat
      ../docs/decisions.md)
  ⎿      15 auth.config.ts
         24 convex.config.ts
         25 crons.ts
     … +1565 lines (ctrl+o to expand)

● Bash(cd /c/Users/sloik/Documents/Projects/composery && cat convex/servers.ts
      convex/server_model.ts convex/server_access.ts
      convex/server_permissions.ts convex/schem…)
  ⎿  import {
        paginationOptsValidator,
        paginationResultValidator,
     … +798 lines (ctrl+o to expand)

  Read 1 file (ctrl+o to expand)

● Bash(cat convex/users.ts; for f in convex/ssh/*.ts; do echo "=== $f"; grep -nE
      "^export|^import|^(const|function|type|interface) " $f; done; echo; cat
      biome.json* 2>…)
  ⎿  import type { User } from "@clerk/backend";
     import { createClerkClient } from "@clerk/backend";
     import { isClerkAPIResponseError } from "@clerk/backend/errors";
     … +492 lines (ctrl+o to expand)

  Read 1 file (ctrl+o to expand)

● Bash(cat convex/ssh/bootstrap_state.ts && git diff convex/schema.ts
      convex/convex.config.ts .env.convex.example && head -60
      convex/ssh/connection.ts convex/ssh/remov…)
  ⎿  import { v } from "convex/values";
     import { internalMutation, internalQuery } from "../_generated/server"
     ;
     … +190 lines (ctrl+o to expand)

● Bash(grep -n "server_\|servers\.\|names\|limits" docs/server-backend-plan.md |
      head -30; grep -rn "type ApiFromModules" -A 25
      node_modules/convex/dist/esm-types/serv…)
  ⎿  3:The first backend uses Hetzner Cloud CX23 servers. It implements cre
     ation, observation, graceful stop, forced stop, start, deletion, and r
     ecovery. Customer SSH, app exposure, snapshots, billing, and the admin
     … +52 lines (ctrl+o to expand)

● I read all of convex/ (except _generated), decisions.md, the backend plan, and
  the setup docs. I don't think we should keep the current shape. Right now we
  have two different ways of grouping files: ssh/ uses a folder, and the server
  code uses a server_ filename prefix. names.ts sits at the top level even
  though it only covers server names. And limits.ts (rate limits) is easy to
  confuse with the server grant limit ("your server limit is reached").

  Naming rules

  Convex builds each function's path from its file path. Every rule below
  follows from that:

  1. The folder names the area; file names don't repeat it. ssh/ already does
     this. Server files move from server_lifecycle.ts to servers/lifecycle.ts,
     and SSH files don't get an ssh_ prefix.
  2. Convex functions don't repeat their path. You always call them through the
     path, so api.servers.members.add is right and api.servers.members.addMember
     repeats itself.
  3. Plain exports do carry the area name. They're imported by bare name, so
     they have to make sense alone: isReservedServerName, SshError, readSshFile.
  4. A file is named after its main export, minus the folder name.
  5. One definition per word. Today "access" means three things: userAccess
     (account disabled), server_access.ts (permission checks), and
     serverSshAccess (a stored credential).
  6. Every table validator lives in schema.ts. Today they're in three places:
     inline in schema.ts, in server_model.ts, and in server_permissions.ts.
     Other files can reuse them through schema.tables.X.validator.fields, the
     way ssh/bootstrap_state.ts already does.

  Proposed layout

  convex/
    auth.config.ts convex.config.ts crons.ts http.ts schema.ts   ← Convex fixes
  these names
    rate_limits.ts            was limits.ts; used by both users and servers
    users/
      current.ts              get, sync, getCurrentUser, requireUser (moved from
  server_access)
      clerk.ts                sync, reconcile, isStored, listClerkUserIds,
  store, disable, remove
    servers/
      lifecycle.ts            create, remove, power, status (+
  provision/deleteServer helpers)
      worker.ts               sweep, claim, dispatch, authorizePower, record,
  retry, run, WorkerUpdate
      grants.ts               reserve, set (was setGrant)
      inventory.ts            schedule, run, record
      hetzner.ts              provider client
      members.ts              list, listMine, add, setPermissions, remove,
  transferOwnership, removeAll, removeForUser
      names.ts                rename, resolve (was getByName),
  checkServerNameClaim, format/reserved checks
      reserved_names.ts       RESERVED_SERVER_NAMES (data only, ~1,400 lines)
      access.ts               requireServerAccess, requireServerOwner,
  getMembership, memberAccess, permission helpers
    ssh/
      authorized_keys.ts  connection.ts  read_file.ts  write_file.ts
  write_file_script.ts
      remove_authorized_keys.ts   was remove_keys.ts (its export is
  removeAuthorizedKeys)
      inspect_public_key.ts       was inspect_key.ts (its export is
  inspectPublicKey)

  Names inside the files

  - names.ts: NAME_PATTERN, RESERVED_NAMES, NAME_FORMAT_MESSAGE,
    isValidNameFormat and isReservedName become SERVER_NAME_*, isValidServerName
    and isReservedServerName.
  - Rate limit keys: nameAttempt, nameClaim and memberLookup become
    serverNameAttempt, serverNameClaim and serverMemberLookup.
  - Tables:
    - serverInventory holds scan cursors, so it becomes serverInventoryScans.
    - serverFindings becomes serverInventoryFindings.
    - userAccess gets a name that says "disabled".
  - Helpers:
    - requestKey checks a request ID, so it becomes requireRequestId.
    - allocationFor becomes getAllocation, to match getMembership.
  - Problems I'd fix in the same pass (CLAUDE.md requires it):
    - Single-letter locals a and u in lifecycle.
    - The same Workpool is created twice, once in inventory and once in
      lifecycle.
    - Magic numbers: inventory hard-codes 120_000 even though WATCHDOG_MS
      exists, and 300_000 is repeated in several places.
    - power writes its own rate-limit message instead of using
      tooManyAttemptsMessage.
  - Docs: update the old paths in decisions.md, server-backend-plan.md,
    setups/hetzner.md, crons.ts, and the frontend's api.users.* calls.

  Risks

  - The other agent is editing schema.ts, convex.config.ts, and the new
    ssh/bootstrap_state.ts. Its serverSshAccess table and bootstrap_state module
    fall under rule 5, and renaming files mid-edit would break its imports. I'd
    wait until it commits, then do the whole rename in one pass.
  - Live deployment data: Convex can't rename a table. If the deployment has
    rows in the tables being renamed, the schema push fails until they're
    cleared (fine on dev) or migrated (needed on prod). Scheduled or queued jobs
    that point at old paths like server_worker:run would also fail, so the
    queue should be empty first. Resetting the renamed rate-limit counters is
    harmless.

  Two things to confirm before I start:
  1. Is there only dev data in these tables, or is anything in production?
  2. Should I wait for the other agent to commit, or start now on everything
     except its three files?

✻ Baked for 3m 49s · done 11:50 AM

❯ Why would we want one definition per word? I feel like depending on the       
  context and the place where the word is used, it's fine to use the same word  
  for different things, no? That would just make everything feel weird. And     
  also, okay, the folder names the area, but then what is, like, servers.ts     
  gonna become if we don't have to declare that it's, like, a server every time 
  in the naming? And is there any alternative shape? And where do you think     
  the decisions lie for me here? Is this truly the best thing that you could    
  have come up with? Can you also research the latest codex guidance on, like   
  structuring things and just, yeah, just best practices and real-world         
  examples, please. There is no production data.                                

● Bash(wc -l convex/_generated/ai/guidelines.md && grep -n -i
      "file\|director\|organiz\|structure\|module\|folder\|path"
      convex/_generated/ai/guidelines.md | head -60;…)
  ⎿  459 convex/_generated/ai/guidelines.md
     16:  path: "/echo",
     26:- HTTP endpoints are always registered at the exact path you specif
     … +65 lines (ctrl+o to expand)

● Web Search("Convex best practices project structure organize functions
            directories")
  ⎿  Did 1 search in 7s

● Web Search("stack.convex.dev code organization convex folder "model" helpers")
  ⎿  Did 1 search in 6s

● Fetch(https://docs.convex.dev/understanding/best-practices/)
  ⎿  Received 35.6KB (200 OK)

● Bash(for r in a16z-infra/ai-town get-convex/chef get-convex/convex-saas
      get-convex/v0-convex get-convex/convex-helpers; do echo "=== $r"; gh api
      "repos/$r/git/trees/…)
  ⎿  === a16z-infra/ai-town
     convex/agent/conversation.test.ts
     convex/agent/conversation.ts
     … +135 lines (ctrl+o to expand)

● Bash(for r in get-convex/workpool get-convex/agent get-convex/workflow
      get-convex/r2 get-convex/better-auth; do echo "=== $r"; gh api
      "repos/$r/git/trees/HEAD?recurs…)
  ⎿  === get-convex/workpool
     src/client/index.test.ts
     src/client/index.ts
     … +139 lines (ctrl+o to expand)

● Bash(for f in src/component/messages.ts src/component/threads.ts
      src/component/users.ts; do echo "=== agent $f"; gh api
      "repos/get-convex/agent/contents/$f" --jq .co…)
  ⎿  === agent src/component/messages.ts
     export const deleteByIds
     export const messageStatuses
     … +52 lines (ctrl+o to expand)

● Web Search("Convex large codebase organize convex directory nested folders
            schema split tables spread")
  ⎿  Did 1 search in 8s
● Fetch(https://docs.convex.dev/understanding/best-practices/other-recommendatio
       ns)
  ⎿  Received 74.7KB (200 OK)

● Fetch(https://docs.convex.dev/functions/query-functions)
  ⎿  Received 9.8KB (200 OK)

● Bash(for f in convex/bootstrap_probe.ts convex/ssh/bootstrap.ts
      convex/ssh/bootstrap_http.ts; do echo "=== $f ($(wc -l < $f) lines)"; head
      -3 $f; grep -nE "^export "…)
  ⎿  === convex/bootstrap_probe.ts (62 lines)
     import { v } from "convex/values";
     import { internalMutation, internalQuery } from "./_generated/server";
     … +16 lines (ctrl+o to expand)

● I took "codex" to mean Convex.

  "One definition per word"

  You're right, and I overstated it. The rule comes from ASD-STE100, which
  CLAUDE.md requires, but the same line says coding conventions win. In code,
  the file, folder, or table name already tells you which meaning a word has.
  access in servers/access.ts and in the userAccess table don't clash, so I'm
  dropping that rename.

  The only real problem is two meanings side by side with nothing to tell them
  apart. There's one case of that today: power in server_lifecycle.ts calls
  const limit = await rateLimiter.limit(...), and the same file checks
  grant.limit. That's the actual reason to rename limits.ts to rate_limits.ts.

  What the research shows

  Convex gives very little official guidance on structure:
  - File paths become API paths. convex/foo/bar.ts is called as api.foo.bar.fn,
    and folders can nest.
  - "Thin" public functions. The docs suggest keeping queries and mutations
    short and putting most logic in plain helper functions in a folder like
    convex/model/. That's all it says about layout.
  - Nothing on naming modules or functions.

  Real projects don't agree with each other:

  Project: chef (Convex)
  Layout: Flat, about 30 top-level files
  Function names: —
  ────────────────────────────────────────
  Project: ai-town
  Layout: One folder per area; each folder has its own schema.ts, merged into
  the
  root schema
  Function names: File names repeat the prefix inside the folder
  (aiTown/agentDescription.ts)
  ────────────────────────────────────────
  Project: Convex agent component
  Layout: Flat modules
  Function names: Repeats the module name (threads.getThread,
  messages.addMessages)
  ────────────────────────────────────────
  Project: Convex workpool component
  Layout: Flat modules
  Function names: Doesn't repeat it (lib.enqueue, lib.status)

  So there isn't one accepted "best" shape. What matters is picking rules we can
  apply the same way everywhere.

  Was my first proposal the best? No

  - The "one word, one meaning" rule was too broad (see above).
  - listMine didn't really belong in members.ts. It only landed there because
    I'd removed servers.ts.
  - Splitting users.ts into a folder was symmetry for its own sake.
  - Every folder-based layout has to answer "where do the functions for the
    server itself go?", and I dodged that by removing servers.ts.
  - I missed that server_model.ts holds table validators, while Convex's docs
    use "model" for business logic.

  What servers.ts becomes: the options

  Shape: A. servers.ts next to servers/
  How calls read: api.servers.create, api.servers.members.add,
  api.servers.lifecycle.power
  Downside: The area lives in a file and a folder. A function can't share a name

  with a subfolder module.
  ────────────────────────────────────────
  Shape: B. Everything inside the folder
  How calls read: api.servers.servers.create
  Downside: Repeats itself. Convex treats index.ts like any other file, so that
  doesn't help.
  ────────────────────────────────────────
  Shape: C. Split by job, no main file
  How calls read: api.servers.names.rename, api.servers.members.listMine
  Downside: Some functions get forced into files where they don't fit.
  ────────────────────────────────────────
  Shape: D. Convex's model/ pattern
  How calls read: api.servers.create, with logic in model/servers.ts
  Downside: Every area gets two homes, and it's a logic refactor, not a rename.

  My pick is A, with one rule: <area>.ts holds the functions for that area's
  main table, and <area>/ holds everything else.
  - users.ts stays a single file.
  - ssh/ has no main table, so there's no ssh.ts.

  The TypeScript types support a file and a folder with the same name, and the
  runtime paths (servers:create and servers/members:add) are different strings.
  I haven't pushed that to a dev deployment yet; I'd do that first.

  convex/
    auth.config.ts convex.config.ts crons.ts http.ts schema.ts   (spreads
  ...serverTables)
    rate_limits.ts
    users.ts            current, syncCurrent, Clerk sync; requireUser moves here
    servers.ts          list, getByName, create, rename, remove
    servers/
      schema.ts         server tables and their validators (replaces
  server_model.ts)
      access.ts         access checks and permission helpers
      names.ts  reserved_names.ts
      members.ts        list, add, setPermissions, remove, transferOwnership,
  removeAll, removeForUser
      lifecycle.ts      power, status, provision and delete helpers
      grants.ts         reserve, set
      worker.ts         sweep, claim, dispatch, authorizePower, record, retry,
  run
      inventory.ts  hetzner.ts
    ssh/                unchanged

  Names inside files: qualify by distance. A name that stays inside its folder
  doesn't repeat the area. For example, isReservedName inside servers/ is clear.
  A name used from another area, or defined in a shared file, carries the
  qualifier: SshError, and serverNameAttempt in rate_limits.ts. This matches
  your point about context, and it keeps constants like NAME_PATTERN short.

  Decisions for you

  1. Where server functions live: A, B, C, or D. I recommend A.
  2. Repeat the module name in function names? (members.add or
     members.addMember.) I recommend not repeating it, because calls always
     include the path.
  3. Schema: one root schema.ts, or a schema.ts per folder merged into the root
     (the ai-town approach). I recommend per folder for folders, and root for
     single-file areas like users.
  4. Table renames: these are now free since there's no production data. For
     example, serverInventory holds scan cursors, so serverInventoryScans fits
     better.

  Timing

  The other agent has now changed server_lifecycle.ts, server_worker.ts,
  schema.ts, and http.ts. It also added a top-level convex/bootstrap_probe.ts
  and ssh/bootstrap.ts. Moving files now would conflict with its work, so I'd do
  this in one pass after it commits. Want to settle the four decisions now?

  Sources:
  - Convex Best Practices
    (https://docs.convex.dev/understanding/best-practices/)
  - Convex Other Recommendations
    (https://docs.convex.dev/understanding/best-practices/other-recommendations)
  - Convex Query Functions (file-based routing)
    (https://docs.convex.dev/functions/query-functions)
  - Authoring Components (https://docs.convex.dev/components/authoring)
  - a16z-infra/ai-town (https://github.com/a16z-infra/ai-town), get-convex/chef
    (https://github.com/get-convex/chef), get-convex/agent
    (https://github.com/get-convex/agent), get-convex/workpool
    (https://github.com/get-convex/workpool)

✻ Brewed for 3m 26s · done 11:56 AM

❯ 1. veering towards D. What's the downside with it, and is there really a      
  point in following the 'model' shape that Convex sometimes talks about? 2.    
  not repeating feels cleaner. 3. don't have an opinion here. 4. yeah. And I do 
  agree with the sentiment you talked about earlier with rate limiting and      
  limiting and whatnot. I'd like a comb through everything to ensure symmetry   
  and cleanliness as well as things being cognitively lightweight to understand 
  and maintain                                                                  

● Bash(git status --short; git log --oneline -3; git ls-files | grep -v
      "^docs/research\|_generated\|^public/" )
  ⎿  M  .env.convex.example
     M  convex/_generated/api.ts
     M  convex/_generated/server.ts
     … +93 lines (ctrl+o to expand)

● Bash(for f in src/proxy.ts src/app/layout.tsx src/app/page.tsx
      src/app/primitives/page.tsx src/app/privacy/page.tsx
      src/app/terms/page.tsx "src/app/sign-in/[[...sign…)
  ⎿  === src/proxy.ts
     import { clerkMiddleware } from "@clerk/nextjs/server";
     … +651 lines (ctrl+o to expand)

● Bash(for f in scripts/research/*.ts scripts/tsconfig.json tsconfig.json
      tsconfig.base.json convex/tsconfig.json next.config.ts postcss.config.mjs
      convex.json bunfig.…)
  ⎿  === scripts/research/chatgpt.ts
     import type { Conversation } from "./conversation";
     … +511 lines (ctrl+o to expand)

● Bash(cat src/app/globals.css; for f in docs/server-backend-plan.md
      docs/setups/*.md docs/ssh-authorized-keys.md; do echo "=== $f"; cat $f;
      done; echo; wc -l docs/*.m…)
  ⎿  /* Clerk puts its component styles in the clerk layer, so utilities ov
     erride them. */
     @layer theme, base, clerk, components, utilities;
     … +426 lines (ctrl+o to expand)

  Read 1 file (ctrl+o to expand)

● Bash(cd convex/ssh && sed -n 60,160p connection.ts; sed -n 1,60p
      inspect_key.ts; sed -n 1,60p read_file.ts; sed -n 1,50p write_file.ts;
      grep -n "function\|const \|cl…)
  ⎿                     start((error, value) => {
                                signal.removeEventListener("abort", abort);
                                if (signal.aborted) {
     … +589 lines (ctrl+o to expand)


● D: what the model/ folder gets you, and what it costs

  D doesn't change what anyone sees from outside. The API calls and file names
  are the same as in A (api.servers.create, api.servers.members.add). The only
  difference is that most of each function's logic moves into a second, parallel
  tree under model/.

  What Convex says it gets you, checked against this repo:
  - Sharing logic inside one transaction. You get this from any exported plain
    function, with or without a folder. The repo already does it:
    requireServerAccess, provision, deleteServer, reserve,
    connectionForAllocation.
  - A small public surface you can audit. A folder doesn't enforce this. Any
    mutation(...) anywhere is callable by clients. What actually separates
    public from private is mutation vs internalMutation.
  - Easier refactors. This helps a little when many entry points (public,
    internal, HTTP, cron) share one operation. Only deleteServer looks like that
    here, and it's already a helper.

  What it costs:
  - Two trees to keep in sync. Every area exists twice (servers/members.ts and
    model/servers/members.ts). Every move or rename happens twice, and every
    change means opening two files.
  - Pointless wrappers. Most handlers here are used once. Pulling their logic
    out produces one-to-one wrappers that add a hop and share nothing.
  - "Model" doesn't describe what's inside. It means "not a Convex function",
    and says nothing about the area. ssh/ would get split in half:
    authorized_keys.ts into model/, bootstrap_state.ts out of it.
  - Convex's own code doesn't use it. chef, workpool, agent, workflow and r2
    have no model/ folder.

  My recommendation is A. I'd keep the useful part of D as a rule rather than a
  folder: when a second function needs some logic, move it into a plain helper
  exported from the file that owns the table it writes. A doesn't block D later,
  because the API stays the same either way.

  Schema (your #3): I'll decide

  One root schema.ts holds every table and every stored-data validator. It's the
  one place to look for "what gets stored", and it won't need to import
  anything from the area files. This replaces server_model.ts and the validator
  in server_permissions.ts.

  Comb-through findings

  I read all of convex/, src/, scripts/, the config files, and the non-research
  docs. I haven't read docs/*-prompts.md or docs/ssh-research-audit.md yet.

  Layout
  - names.ts and the reserved list move to servers/names.ts and
    servers/reserved_names.ts.
  - The server_*.ts files move to servers/*.ts, hetzner.ts moves to
    servers/hetzner.ts, and limits.ts becomes rate_limits.ts.
  - server_lifecycle.ts (548 lines) does three jobs, so it splits into:
    - lifecycle.ts: power, status
    - grants.ts: reserve, set
    - worker.ts: sweep, claim, dispatch, authorizePower, record, retry, plus
      WorkerUpdate
  - requireUser moves to users.ts, next to getCurrentUser.
  - servers.ts: listMine, getByName, create, rename, remove, transferOwnership.
    Ownership belongs here because it writes servers.ownerId.
  - servers/members.ts: list, add, setPermissions, remove, removeAll,
    removeForUser.
  - SSH files: remove_keys.ts becomes remove_authorized_keys.ts, and
    inspect_key.ts becomes inspect_public_key.ts, to match their exports.

  Same word, two meanings in one place
  - inventory.record uses scan.kind (servers/primary_ips) and resource.kind
    (server/ipv4) in the same function. The scan field needs a different name.
  - power has const limit = await rateLimiter.limit(...) in the same file as
    grant.limit.
  - In servers.ts, status holds both a rate-limit result and a userAccess row.

  Same thing, several names
  - Rate-limit results go by status, attempt, claim, lookup, limit, and pacing.
    They should share one name.
  - A serverNames row goes by nameRecord, taken, and claim. decisions.md calls
    it a claim, so that's the name.
  - One registration step, two names: registerSshHost (HTTP) and registerHostKey
    (action).
  - Error-code prefixes differ. SshBootstrapError codes carry an ssh_ prefix,
    but SshError codes don't.
  - Loose helper names. object, list, textField, idField and owned in hetzner.ts
    don't follow one verb pattern. ProviderError is only thrown for Hetzner, so
    it becomes HetznerError.
  - Verbs: delete means destroy and remove means take out of a set. remove also
    stands in for delete in export names, because delete is a reserved word.
  - display means two things. font-display is Chakra Petch, but tracking-display
    is used on Onest headings. The same face is also called both --font-brand
    and font-display.
  - Constant casing is mixed. RESERVED_NAMES (a Set) uses SCREAMING_CASE, but
    keyTypes (a Set) doesn't. My rule: SCREAMING_CASE only for simple values
    (numbers, patterns, messages), camelCase for objects.

  Repeats and magic numbers
  - 300_000 means three different things (power deadline, inventory wait,
    IDLE_MS). inventory hard-codes 120_000 even though WATCHDOG_MS exists.
  - One hour is written as 3_600_000 in one place and 60 * 60 * 1000 in another.
  - The same Workpool is defined twice, in inventory and lifecycle.
  - status rewrites the query that allocationFor already does.
  - There are single-letter names (a, u, e, s, r) in the lifecycle, worker and
    inventory files.

  Other problems I found (CLAUDE.md requires fixing them)
  - power throws after it counts a rate-limit attempt. Convex rolls that count
    back, so failed power commands are never limited. This goes against the
    rate-limit decision.
  - Two error shapes reach the client. servers.ts throws ConvexError({ message 
    }), but the lifecycle code throws ConvexError("string").
  - userAccess.disabled is always true. A missing row already means "enabled",
    so there are two ways to say one thing.
  - isStored is misleading. It also checks that the user isn't disabled.
  - docs/server-backend-plan.md is out of date. It still describes read/write
    roles, lists old API paths, and says there's no test framework. It describes
    the current system, so I'd rename it docs/servers.md.
  - Mixed prop typing in components. Some components use a named XProps type and
    others use inline types.

  Your #4 (table renames) is covered: serverInventory becomes
  serverInventoryScans, and serverFindings becomes serverInventoryFindings. I'd
  also write the naming rules into decisions.md so future code follows them.

  Next step

  The other agent's changes (ssh/bootstrap*, lifecycle, worker, schema) are
  still uncommitted, and several findings touch those files. Once it commits,
  I'd do everything in one pass: moves, renames, and fixes, then clear the dev
  tables. Then I'd run bun run verify and a Convex dev push to check it.

  Shall I go with A, or do you still want D after this?

✻ Brewed for 6m 34s · done 12:13 PM

❯ I feel like I kind of understand what you're saying, but, like, still a       
  servers.ts file next to a servers directory does feel kind of loaded or,      
  like, weird maybe. Though perhaps it might be the most standard shape that we 
  could land on. But obviously I don't want some jargon, like                   
  api.servers.servers.create                                                    
                                                                                
  I feel like a model directory would kind of make things messy, personally. So 
  I'm not inclined to pursue it.                                                
                                                                                
  I also don't mind if we prematurely organize things, if you think that it's   
  gonna make sense in the future. But then again, I wouldn't want folders with  
  just single files inside of them.                                             
                                                                                
  Also, you said casing is mixed. Can you verify all casing across, like the    
  entire repo and, yeah, just take a look at if we are currently aligned?       
  Because I think we should be, and I think we should declare some sort of      
  casing policy, probably in the agents.md file, right? As cleanly as possible, 
  without overbloating it. Just a simple instruction. Maybe an inviolable       
  rule, I guess.                                                                
   And you've actually spotted quite a few issues with how the code is written  
  and how maintainable it is, and yeah, how much it follows the best practices  
  for TypeScript. And I feel like this is really important to act on and really 
  dig into further and drill down into further, right? So maybe we would just   
  do a sort of blanket kind of refactor that doesn't introduce any edge cases,  
  and in fact might only make the entire system more airtight from now. It      
  makes everything truly maintainable and properly interpretable, as well as    
  symmetric and following maybe a certain clean, lean policy. I would like to   
  take things one or a few steps at a time. The agent is currently not working  
  since it ran out of the limit. I feel like we might continue the development  
  from after we refactor, because the context that you acquired that the server 
  backend plan is actually outdated is quite crucial, because other agents      
  will probably not have that context and not have this nugget of quality       
  already refined in the conversation and in the context window. And so maybe   
  after we refactor, I can give you the conversation and we can continue on     
  from it and, like, reconcile certain things, like the documentation, delete   
  certain things, and yeah, I mean, just keep in mind that all UI research      
  prompts, server backend plan, SSH authorized keys, SSH research audit, SSH    
  research prompts, when they are all used, they are gonna be deleted. And I    
  think some of them are not used, or maybe, like you said, they are outdated   
  at this point.  But still, is there no more granularity than A or B or C or   
  D? And do you think there is nothing else for me to decide? I agree on the    
  schema decision. All of the TypeScript sort of sins and stuff, like magic     
  numbers and single-letter names in different places, and, yeah, just all      
  other non-best-practices stuff or things. They should really be taken         
  seriously, in my opinion. Perhaps you can give me a research prompt to give   
  to ChatGPT, or even a few of them, or even five of them if you so choose.     
  That would help you really review all of the TypeScript in the current code   
  base against the latest best practices and real-world examples. Though that   
  is not necessary if you feel like you don't need that, or you can check it    
  yourself easier and faster. That research will take, like, another, I'd say,  
  20 minutes.                                                                   

● Now checking casing across the whole repo, and whether Biome can enforce a
  casing rule instead of relying on prose alone.

● Bash(cd /c/Users/sloik/Documents/Projects/composery
      F=$(git ls-files '*.ts' '*.tsx' '*.mjs' | grep -v _generated)…)
  ⎿  ## top-level const/let names by casing
     SCREAMING: CHATGPT_SHARE_URL CITATION_MARKER CLERK_PAGE_SIZE DELETE_BA
     TCH_SIZE IDLE_MS NAME_FORMAT_MESSAGE NAME_PATTERN NEVER READERS RESEAR
     … +68 lines (ctrl+o to expand)

● Bash(cd /c/Users/sloik/Documents/Projects/composery;
      S=node_modules/@biomejs/biome/configuration_schema.json; for r in
      useNamingConvention noMagicNumbers noShadow us…)
  ⎿  useNamingConvention: 1
     noMagicNumbers: 1
     noShadow: 1
     … +20 lines (ctrl+o to expand)

● Bash(mkdir -p tmp/biome-audit && cat > tmp/biome-audit/biome.json <<'EOF'
      {…)
  ⎿  lint ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     … +62 lines (ctrl+o to expand)

● Bash(../../node_modules/.bin/biome lint --reporter=summary . 2>&1 | sed -n
      '/lint rules have violations/,$p'; echo ----;
      ../../node_modules/.bin/biome lint --only=st…)
  ⎿    i The following lint rules have violations:

       Rule Name                                                    Diagnos
     … +67 lines (ctrl+o to expand)

● Bash(B=../../node_modules/.bin/biome; for r in
      complexity/noExcessiveCognitiveComplexity style/noNestedTernary
      suspicious/noShadow suspicious/useErrorMessage; do ech…)
  ⎿  == complexity/noExcessiveCognitiveComplexity
     convex\hetzner.ts:34:23
     convex\server_inventory.ts:75:29
     … +56 lines (ctrl+o to expand)

● Bash(cd /c/Users/sloik/Documents/Projects/composery && rm -rf tmp/biome-audit
      && ls tmp 2>/dev/null | head)
  ⎿  Error: Exit code 1
     rm: cannot remove 'tmp/biome-audit': Device or resource busy

● PowerShell(Set-Location C:\Users\sloik\Documents\Projects\composery;
            Remove-Item -Recurse -Force tmp\biome-audit -Confirm:$false;
            Test-Path tmp\biome-audit)
  ⎿  Remove-Item : Cannot remove item C:\Users\sloik\Documents\Projects\com
     posery\tmp\biome-audit: The process cannot
     access the file 'C:\Users\sloik\Documents\Projects\composery\tmp\biome
     … +12 lines (ctrl+o to expand)

● Bash(rm -rf tmp/biome-audit; ls tmp/biome-audit 2>&1 | head -3)
  ⎿  ls: cannot access 'tmp/biome-audit': No such file or directory
● I checked casing across the repo and ran stricter lint rules on a scratch copy
  (now deleted). Here's where things stand.

  1. Layout: yes, there are finer options

  The choices vary along three separate questions:

  ┌───────────────────┬─────────────────────────────────────────────────────┐
  │     Question      │                       Options                       │
  ├───────────────────┼─────────────────────────────────────────────────────┤
  │ Where the         │ next to a folder (A) · a file named after the       │
  │ server's own      │ folder (B) · split by job (C) · model/ folder (D) · │
  │ functions live    │  a top-level file with the backend in a second      │
  │                   │ folder                                              │
  ├───────────────────┼─────────────────────────────────────────────────────┤
  │ Where plain       │ next to the functions that use them · a separate    │
  │ helpers live      │ folder                                              │
  ├───────────────────┼─────────────────────────────────────────────────────┤
  │ Folders per area  │ servers/ only · servers/ plus allocations/          │
  └───────────────────┴─────────────────────────────────────────────────────┘

  Your constraints are: nothing next to a folder with the same name, no
  servers.servers, no model/, and no folders with a single file. That leaves
  splitting by job inside servers/. My earlier version of it had a weak spot,
  which the version below fixes.

  The key fact is that serverOperations.kind is already create | start | stop | 
  forceStop | delete. Those five are the lifecycle, so all of them go in one
  file.

  convex/
    auth.config.ts convex.config.ts crons.ts http.ts schema.ts
    rate_limits.ts
    users.ts
    servers/
      lifecycle.ts       create, power, remove, status     ← every operation
  kind
      names.ts           rename, getByName, name-claim checks
      reserved_names.ts
      memberships.ts     list, listMine, add, setPermissions, remove,
  transferOwnership, removeAll, removeForUser
      access.ts          requireServerAccess, requireServerOwner, getMembership,
  permission helpers
      grants.ts          reserve, set
      worker.ts          sweep, claim, dispatch, authorizePower, record, retry,
  run
      inventory.ts       schedule, run, record
      hetzner.ts
    ssh/ …

  listMine was the function with no clear home. It fits once the file is named
  memberships: api.servers.memberships.listMine reads as "list my memberships",
  which is what it returns. The code already calls these rows membership
  (getMembership), even though the table is serverMembers. So the table becomes
  serverMemberships.

  If the Hetzner backend grows a lot, allocations/ could split out later.
  decisions.md already treats server identity and the backend as separate. It
  isn't needed today.

  2. Casing audit

  Already consistent:
  - Types, classes and components use PascalCase; functions use camelCase.
  - Table and field names use camelCase.
  - Convex index names (by_x_and_y), error codes, and env vars follow one style
    each.
  - File names are kebab-case in src/ and docs/, and snake_case in convex/.
  - Acronyms are written as words (SshError, imageUrl).

  Not consistent:
  - Module-level constants. 13 use CONSTANT_CASE (RESERVED_NAMES, WATCHDOG_MS,
    READERS, SPECIAL_VALUES…), while the same kinds of values elsewhere use
    camelCase (keyTypes, outcomes, widths, the numbers in logo.tsx). There's no
    rule deciding which.
  - String values the code defines. Most are camelCase (forceStop,
    hetznerCloud). Exceptions: primary_ips, which is really Hetzner's endpoint
    name stored in a field called kind, and "sign-in"/"sign-up" in AuthButton.
  - How "ChatGPT" is split into words. chatgpt.ts and CHATGPT_SHARE_URL treat it
    as one word; readChatGptShare treats it as two.

  All 34 hits from Biome's naming rule are external formats: env var keys,
  Hetzner and cloud-init JSON, ChatGPT's JSON, ignoreBOM, and Convex's
  applicationID. Our own names pass. But Biome's default allows both
  CONSTANT_CASE and camelCase for constants, so it can't catch the mix above. A
  custom setting that allows only camelCase flags exactly those 13 constants, so
  Biome can enforce the rule.

  Proposed rule for AGENTS.md (one bullet in the inviolable section, since
  CLAUDE.md links to it):

  ▎ - "Use one casing policy. Use PascalCase for types, classes, and components.
  ▎ Use camelCase for all other identifiers and for string values that the code
  ▎ defines. Use snake_case for Convex file names, index names, and error 
  ▎ codes. Use kebab-case for other file names and for CSS. Use CONSTANT_CASE 
  ▎ only for environment variables. Write acronyms as words. A name from an 
  ▎ external contract keeps its casing."

  3. Which lint rules to turn on

  These are the violation counts from the dry run, which is how I'd size the
  cleanup:

  Rule: naming (camelCase constants, strict acronyms)
  Hits: 13
  My pick: Turn on; allow external formats
  ────────────────────────────────────────
  Rule: noNestedTernary
  Hits: 6
  My pick: Turn on
  ────────────────────────────────────────
  Rule: noShadow
  Hits: 1
  My pick: Turn on
  ────────────────────────────────────────
  Rule: useErrorMessage
  Hits: 1
  My pick: Turn on
  ────────────────────────────────────────
  Rule: useConsistentTypeDefinitions (set to type)
  Hits: 7
  My pick: Turn on
  ────────────────────────────────────────
  Rule: noMagicNumbers
  Hits: 103
  My pick: Fix by hand. The rule also flags HTTP status codes and byte offsets,
  and naming those makes code harder to read.
  ────────────────────────────────────────
  Rule: noExcessiveCognitiveComplexity
  Hits: 11
  My pick: Fix by hand. Most hits are the SSH parsers, where splitting at a
  fixed
  threshold makes them worse.
  ────────────────────────────────────────
  Rule: useExplicitType
  Hits: 121
  My pick: Leave off. It conflicts with Convex's inferred types.

  4. ChatGPT research prompts

  I don't need them. The problems I found are well-established ones, and the
  lint dry run plus reading the code checks them against this repo directly.
  That's faster and more reliable than a general survey. If you'd like a second
  opinion anyway, I can write one focused prompt.

  5. Decisions left for you

  1. Layout: the split-by-job layout above, including the serverMemberships
     rename.
  2. Casing: camelCase-only constants (Biome can enforce it, no judgment calls),
     or also allow CONSTANT_CASE for simple values (can't be enforced). I
     recommend camelCase-only.
  3. Lint rules: the picks in the table above.
  4. The other agent's uncommitted SSH bootstrap work. I can't tell whether it's
     finished. My recommendation is that you commit it as is before the
     refactor, so its diff stays separate and nothing gets lost. The other
     option is to let that agent finish first.

  I'll decide these myself:
  - Error shape: always ConvexError({ message }).
  - Docs: the refactor fixes paths in decisions.md and setups/. The five docs
    you plan to delete wait for the reconciliation afterwards.

  6. Steps (I stop after each one for your review)

  1. The casing rule, the Biome settings, and fixes for what they flag.
  2. Layout: move files, rename API paths, tables and rate-limit keys, update
     doc references, then clear the dev tables. Check with bun run verify and a
     Convex dev push.
  3. Code-quality pass, one area at a time:
     - named constants in place of magic numbers
     - full names in place of single-letter ones
     - removing the duplicate Workpool and queries
     - one error shape
     - the power rate-limit rollback bug
     - nested ternaries and overly complex functions
  4. Reconcile the docs, with the conversation you give me.

✻ Churned for 4m 25s · done 12:33 PM

❯ What would need to happen to the Hetzner backend for allocations to be split  
  out later? And what if we split them out now? How would that look like versus 
  later?                                                                        
                                                                                
  And I feel like on the agent role, we should be maybe a tiny bit more         
  explicit on, like, the failure mode of, like the one that you spotted with    
  ChatGPT being differently cased. So that, you know, just things are, like     
  basically the agent is instructed to maybe check or align casing in terms of  
  this pattern to other places where the same word might be used, maybe in a    
  different casing, maybe in the same one.                                      
                                                                                
  For all of the lint rules, I feel like you need more grounding and more       
  research on the latest config stuff because this should not be guessed around 
  and taken lightly. A messy and ungrounded config starts making everything     
  messy and ungrounded.  I would also like you to, yeah, look at the            
  conversation now and then decide if now is a good point to commit and then    
  commit if that's the case, and just follow our commit message patterns that   
  we have had in the past, I guess. And if it's not yet a good time to commit,  
  then don't, since we're gonna probably later change this on top and then      
  finish out the slice or whatever bit of work we were doing. Show, like, the   
  complete structure and how things would look like, maybe via ASCII, maybe via 
  just a file tree or whatever, just so I can get a picture of what you're      
  planning, really. The conversation is                                         
  codex://threads/01a09dbf-989d-7a81-89ef-95f662ef6572                          

● Locating the Codex thread first so I can judge whether the other agent's work
  is ready to commit.

  Listed 1 directory (ctrl+o to expand)

● Bash(cd ~/.codex/sessions/2026/09/14; ls -la *01a09dbf*;
      F=rollout-2026-09-14T03-29-34-01a09dbf-989d-7a81-89ef-95f662ef6572.jsonl;
      head -c 600 $F | cut -c1-600; echo…)
  ⎿  -rw-r--r-- 1 sloik 197609 5251269 Sep 14 06:34 rollout-2026-09-14T03-2
     9-34-01a09dbf-989d-7a81-89ef-95f662ef6572.jsonl
     -rw-r--r-- 1 sloik 197609  855444 Sep 14 11:08 rollout-2026-09-14T06-3
     … +23 lines (ctrl+o to expand)
  ⎿  Shell cwd was reset to C:\Users\sloik\Documents\Projects\composery

● Bash(cd ~/.codex/sessions/2026/09/14;
      OUT="C:/Users/sloik/AppData/Local/Temp/claude/C--Users-sloik-Documents-Pro
      jects-composery/fe87350c-d8c9-490b-b23b-7e4ac6a39288/…)
  ⎿  104749
  ⎿  Shell cwd was reset to C:\Users\sloik\Documents\Projects\composery

● Bash(F="C:/Users/sloik/AppData/Local/Temp/claude/C--Users-sloik-Documents-Proj
      ects-composery/fe87350c-d8c9-490b-b23b-7e4ac6a39288/scratchpad/codex-threa
      d.md"; grep -…)
  ⎿  835: === ASSISTANT 2026-09-14T10
     841: === ASSISTANT 2026-09-14T10
     847: === ASSISTANT 2026-09-14T10
     … +38 lines (ctrl+o to expand)

  Read 1 file (ctrl+o to expand)

● Bash(F="C:/Users/sloik/AppData/Local/Temp/claude/C--Users-sloik-Documents-Proj
      ects-composery/fe87350c-d8c9-490b-b23b-7e4ac6a39288/scratchpad/codex-threa
      d.md"; awk '/…)
  ⎿  === USER 2026-09-14T02:31:06.965Z
     look at codex://threads/01a09c1a-7861-7050-befe-1099597ed329
     … +329 lines (ctrl+o to expand)

● Bash(cd ~/.codex/sessions/2026/09/14; node -e '
      const fs=require("fs");const lines=fs.readFileSync(process.argv[1],"utf8")
      .split("\n").filter(Boolean);…)
  ⎿  --EVENT 2026-09-14T11:14:51.610Z item_completed {"type":"item_complete
     d","thread_id":"01a09dbf-989d-7a81-89ef-95f662ef6572","turn_id":"01a09
     fa0-81ef-7f33-9803-24971563b880","item":{"type":"UserMessage","id":"01
     … +29 lines (ctrl+o to expand)
  ⎿  Shell cwd was reset to C:\Users\sloik\Documents\Projects\composery

● The previous agent completed and verified its SSH bootstrap slice before
  hitting its usage limit, leaving only that one finished change in the working
  tree (it hadn't touched the firewall step). I'll run the repo checks now
  before deciding on a commit.

● Bash(git status --short && bun run check 2>&1 | tail -25; echo "== tests"; bun
      test 2>&1 | tail -5)
  ⎿  M  .env.convex.example
     M  convex/_generated/api.ts
     M  convex/_generated/server.ts
     … +24 lines (ctrl+o to expand)

● Bash(git diff --cached --stat; git diff --cached | grep -nE
      "^\+.*(probe|console\.log|TODO|FIXME|debug)" ; git diff --cached
      convex/server_worker.ts convex/server_li…)
  ⎿   .env.convex.example           |   2 +
      convex/_generated/api.ts      |   6 ++
      convex/_generated/server.ts   |   1 +
     … +166 lines (ctrl+o to expand)

● Bash(git commit -q -F - <<'EOF'
      add trusted ssh bootstrap through normal provisioning:…)
  ⎿  f11bba9 add trusted ssh bootstrap through normal provisioning: - separ
     ate encrypted management key per allocation - server-generated host ke
     y registered through an authenticated, expiring callback - duplicate-s
     … +3 lines (ctrl+o to expand)

● Fetch(https://biomejs.dev/linter/rules/use-naming-convention/)
  ⎿  Received 315.7KB (200 OK)

● Fetch(https://biomejs.dev/linter/rules/no-magic-numbers/)
  ⎿  Received 92.3KB (200 OK)

● Fetch(https://biomejs.dev/linter/rules/use-consistent-type-definitions/)
  ⎿  Received 112.9KB (200 OK)

● Fetch(https://biomejs.dev/linter/rules/)
  ⎿  Received 0 bytes (404 Not Found)

● Bash(B=node_modules/.bin/biome; $B --version; npm view @biomejs/biome version
      time.modified 2>/dev/null | head -3; for r in useNamingConvention
      noMagicNumbers noNest…)
  ⎿  Version: 2.5.13

     version = '2.5.13'
     … +142 lines (ctrl+o to expand)

● Fetch(https://google.github.io/styleguide/tsguide.html)
  ⎿  Received 137.8KB (200 OK)

● Fetch(https://typescript-eslint.io/rules/naming-convention/)
  ⎿  Received 164.6KB (200 OK)

● Bash(node -e '
      const
      s=require("./node_modules/@biomejs/biome/configuration_schema.json");…)
  ⎿  :"Enforces the usage of the title element for the svg element.\nSee ht
     tps://biomejs.dev/linter/rules/no-svg-without-title","anyOf":[{"$ref":
     "#/$defs/NoSvgWithoutTitleConfiguration"},{"type":"null"}]},"preset":{
     … +10 lines (ctrl+o to expand)

● Bash(node -e 'const
      s=require("./node_modules/@biomejs/biome/configuration_schema.json");conso
      le.log(JSON.stringify(s.$defs.PresetConfig||s.definitions?.PresetConfig…)  ⎿  {
       "description": "A preset configuration for enabling a set of rules."
     ,
     … +65 lines (ctrl+o to expand)

● Bash(B=../../node_modules/.bin/biome
      echo "== magic numbers by value"; $B lint --only=style/noMagicNumbers
      --max-diagnostics=200 . 2>&1 | grep -E "^\s+> [0-9]+ │" -A…)
  ⎿  == magic numbers by value
     [eval]:3
     for(const d of j.diagnostics){const p=d.location.path?.file||d.locatio
     … +28 lines (ctrl+o to expand)

● Bash(cat > magic.cjs <<'EOF'
      const fs = require("fs");…)
  ⎿  Error: Exit code 1
     C:\Users\sloik\Documents\Projects\composery\tmp\lint-audit\magic.cjs:6
       const [a, b] = d.location.span;
                      ^

     TypeError: undefined is not iterable (cannot read property 
     Symbol(Symbol.iterator))
         at Object.<anonymous> 
     (C:\Users\sloik\Documents\Projects\composery\tmp\lint-audit\magic.cjs:6:18)
         at Module._compile (node:internal/modules/cjs/loader:1871:14)
         at Object..js (node:internal/modules/cjs/loader:2002:10)
         at Module.load (node:internal/modules/cjs/loader:1594:32)

     … +6 lines (ctrl+o to expand)

● Bash(../../node_modules/.bin/biome lint --only=style/noMagicNumbers
      --max-diagnostics=1 --reporter=json . 2>/dev/null | node -e 'const
      j=JSON.parse(require("fs").rea…)
  ⎿  {
       "path": "convex\\hetzner.ts",
       "start": {
     … +8 lines (ctrl+o to expand)

● Bash(cat > magic.cjs <<'EOF'
      const fs = require("fs");…)
  ⎿  409            7   convex\hetzner.ts,convex\server_worker.ts
     256            5   convex\ssh\authorized_keys.test.ts,convex\ssh\boots
     trap.ts,convex\ssh\remove_keys.ts,convex\ssh\write_file.ts
     … +44 lines (ctrl+o to expand)

● Bash(cd /c/Users/sloik/Documents/Projects/composery &&
      B=node_modules/.bin/biome; for r in correctness/noUnresolvedImports
      correctness/noUndeclaredDependencies corre…)
  ⎿  correctness/noUnresolvedImports: convex\ssh\bootstrap.ts:10:8 src\comp
     onents\brand\logo.tsx:4:8
     correctness/noUndeclaredDependencies: src\components\convex-client-pro
     … +38 lines (ctrl+o to expand)

● Bash(rm -rf tmp/lint-audit && echo removed)
  ⎿  removed

● 1. Commit: done

  The Codex thread shows the SSH bootstrap slice was finished and tested on a
  real disposable VPS. After that, you agreed the firewall policy (inbound TCP
  22/80/443, UDP 443 and ICMP; outbound allowed). The agent then ran one
  read-only command and hit its usage limit, so no firewall change or file edit
  was made.

  The working tree held only the finished slice. bun run check and all 58 tests
  pass. I committed it as f11bba9: a lowercase summary line plus bullets, like
  753b1ad. I left off the co-author line because none of the earlier commits
  have one, and the code was written by Codex.

  Carry-over for after the refactor: apply that firewall policy and check that
  the backend can log in over SSH. docs/setups/hetzner.md still says backend SSH
  needs a rule for the backend's own addresses, which the agreed policy
  replaces.

  2. Splitting out allocations: now or later

  What ties the backend to servers today (from reading the code):
  - The backend deletes server data itself. When deletion finishes,
    server_lifecycle.record deletes the servers row and schedules
    servers.deleteMembers.
  - deleteServer deletes the servers row directly when there's no allocation.
  - Server code calls backend internals directly:
    - servers.create calls reserve and provision
    - servers.remove calls deleteServer
    - transferOwnership reads serverAllocations.deleteRequested
  - SSH depends on allocations, not servers. ssh/bootstrap* reads
    serverAllocations, and its credentials are stored per allocation.

  What splitting takes either way:
  - Move the grant, worker, inventory and Hetzner code into allocations/.
  - Server code reaches the backend only through a few plain helpers: provision,
    requestPower, requestDeletion, getStatus.
  - The backend hands deletion back through one call,
    servers/lifecycle.finishDeletion, instead of deleting server rows itself.

  Later costs more than now:
  - Queued work breaks. Convex scheduled jobs (the _scheduled_functions table)
    and Workpool items point at functions by path, such as server_worker:run.
    Renaming paths while jobs are queued needs two deploys: add the new path,
    keep the old one forwarding until the queue is empty.
  - Two refactors instead of one. This refactor already renames every path, so
    doing the split later means renaming and re-documenting everything a second
    time.

  Now: there's no production data or queued work, and the paths are changing
  anyway. The dependency direction is also already visible: servers →
  allocations ← ssh. I recommend splitting now.

  3. Casing rule, with word splitting added

  ▎ - "Use one casing policy. Use PascalCase for types, classes, and components.
  ▎ Use camelCase for all other identifiers and for string values that the code
  ▎ defines. Use snake_case for Convex file names, index names, and error 
  ▎ codes. Use kebab-case for all other file names and for CSS. Use 
  ▎ CONSTANT_CASE only for environment variables. Write acronyms and brand names
  ▎ as words (SshError, imageUrl). Split a word at the same places in every 
  ▎ casing (chatGpt, chat-gpt). Before you name something, search for that word 
  ▎ in the repository and use its existing spelling. A name from an external 
  ▎ contract keeps its casing."

  How this compares with mainstream guides: Google's TS guide uses CONSTANT_CASE
  for module-level constants, and the defaults of both typescript-eslint and
  Biome allow either style. Using camelCase for all constants is stricter than
  those defaults. I chose it because Biome can enforce it with no judgment
  calls, while CONSTANT_CASE can't be enforced.

  4. Lint rules, checked properly

  Facts:
  - Biome 2.5.13 is the latest release (npm, published 2026-09-10), so the docs
    match the installed binary.
  - preset accepts recommended, all, or none.
  - None of the candidate rules are in recommended, except noNonNullAssertion
    and the unused-code rules, which are already on.

  Method: instead of hand-picking rules, I linted a copy of the repo with
  preset: "all". 49 rules reported something. I rechecked the import-resolution
  rules in the real repo, and each rule below has a specific reason.

  Adopt:

  Rule: useBlockStatements
  Hits: 207
  Why: Mixed style, like the casing mix: convex/ 195, scripts/ 12, src/ 0.
  Google's guide requires braces.
  ────────────────────────────────────────
  Rule: noMagicNumbers
  Hits: 103
  Why: About 70 are durations, size limits, crypto offsets and exit codes. About

  33 are HTTP statuses, and the retryable-status list appears twice. It skips
  0/1/2/10/24/60, variable initializers and object values, so a named constant
  satisfies it.
  ────────────────────────────────────────
  Rule: useNamingConvention
  Hits: 47
  Why: 13 are our CONSTANT_CASE constants. 34 are external formats (env keys,
  Hetzner/cloud-init/ChatGPT JSON), handled with a per-file override.
  ────────────────────────────────────────
  Rule: useTopLevelRegex
  Hits: 16
  Why: Regexes are rebuilt on every call and have no names.
  ────────────────────────────────────────
  Rule: useNumericSeparators
  Hits: 11
  Why: The repo already writes 120_000; 11 numbers don't.
  ────────────────────────────────────────
  Rule: noExcessiveCognitiveComplexity
  Hits: 11
  Why: record, step, find, request, the parsers.
  ────────────────────────────────────────
  Rule: useExplicitLengthCheck
  Hits: 7
  Why: !list.length becomes list.length === 0.
  ────────────────────────────────────────
  Rule: noNestedTernary
  Hits: 6
  Why:
  ────────────────────────────────────────
  Rule: useAwait
  Hits: 5
  Why: async functions with no await.
  ────────────────────────────────────────
  Rule: noUnusedTemplateLiteral
  Hits: 4
  Why:
  ────────────────────────────────────────
  Rule: noUnnecessaryConditions
  Hits: 2
  Why:
  ────────────────────────────────────────
  Rule: noShadow, useErrorMessage, useMaxParams
  Hits: 1 each
  Why: provision takes 6 parameters.

  Decide: useConsistentTypeDefinitions, 7 hits. Biome's default,
  typescript-eslint's default, and the TS handbook all prefer interface for
  object shapes. The repo uses only type, and most of its types (Readonly<…>,
  unions, intersections) must be type anyway. I recommend type, so there's one
  keyword everywhere.

  Reject, with reasons:
  - Would break or fight required framework code:
    - noDefaultExport (13): Next.js pages and Convex schema, HTTP and crons
      files need default exports.
    - useComponentExportOnlyModules (9): Next.js metadata exports.
    - noProcessEnv (7), noNodejsModules (4): Convex Node actions and Next.js
      config.
    - useExplicitType (121): unstable (nursery) rule, and it conflicts with
      Convex's inferred types.
  - Wrong framework: Solid, Qwik and non-React-props rules (96).
  - The linter can't see our setup: noUnresolvedImports,
    noUndeclaredDependencies and noUndeclaredVariables fail on the @convex/*
    alias, SVG imports, the ssh2 default import, and the Bun global.
  - Would ask us to drop the correct form:
    - noBitwiseOperators: file-mode masks are the correct form.
    - noAwaitInLoops (17): ordered writes inside one Convex transaction are
      intended.
    - useErrorCause (3): the SSH and Hetzner code drops underlying errors on
      purpose, so only stable error codes get out.
  - False positives: noSecrets (4): regexes and test key data.
  - Taste, with no defect behind it: noTernary (70), noJsxLiterals,
    noIncrementDecrement, noContinue, useDestructuring,
    useSimplifiedLogicExpression, useExportsLast, and the per-function/per-file
    line limits (the reserved-names data file trips them).
  - A real problem, fixed by hand rather than by a rule: noConsole (4). Two UI
    failures are only logged to the console. Showing them to the user needs the
    floating UI primitive, which doesn't exist yet.

  5. Planned structure (splitting allocations now)

  composery/
  ├── AGENTS.md                      + casing rule          (CLAUDE.md →
  AGENTS.md)
  ├── biome.json                     + adopted rules, external-format override
  ├── .env.convex.example  .env.local.example  convex.json  next.config.ts
  package.json  …
  ├── convex/
  │   ├── _generated/
  │   ├── auth.config.ts  convex.config.ts  crons.ts  http.ts
  │   ├── schema.ts                  every table + stored-data validator   ←
  absorbs server_model.ts
  │   ├── rate_limits.ts             ← limits.ts
  │   ├── users.ts                   current · syncCurrent · Clerk sync ·
  requireUser
  │   ├── servers/                   what a user owns and shares
  │   │   ├── access.ts              requireServerAccess · requireServerOwner ·
  getMembership · permission helpers
  │   │   ├── lifecycle.ts           create · power · remove · status ·
  finishDeletion
  │   │   ├── memberships.ts         list · listMine · add · setPermissions ·
  remove · transferOwnership · removeAll · removeForUser
  │   │   ├── names.ts               rename · getByName · name-claim checks
  │   │   └── reserved_names.ts      reservedNames
  │   ├── allocations/               the Hetzner machine behind a server
  │   │   ├── grants.ts              reserve · set
  │   │   ├── hetzner.ts             API client · HetznerError
  │   │   ├── inventory.ts           schedule · run · record
  │   │   ├── operations.ts          provision · requestPower · requestDeletion
  · getStatus · requireRequestId
  │   │   ├── worker.ts              run  ("use node")
  │   │   └── worker_state.ts        sweep · claim · dispatch · authorizePower ·
  record · retry
  │   └── ssh/                       access to the machine
  │       ├── authorized_keys.ts  authorized_keys.test.ts
  │       ├── bootstrap.ts ("use node")  bootstrap_http.ts  bootstrap_state.ts
  │       ├── connection.ts  read_file.ts  write_file.ts  write_file_script.ts
  │       ├── inspect_public_key.ts      ← inspect_key.ts
  │       └── remove_authorized_keys.ts  ← remove_keys.ts
  ├── src/                           layout unchanged; the lint fixes land here
  │   ├── proxy.ts
  │   ├── app/  layout.tsx · page.tsx · globals.css · icon.svg · primitives/ ·
  privacy/ · sign-in/[[...sign-in]]/ · terms/
  │   └── components/  account-control · auth-button · convex-client-provider ·
  footer · header · legal-page · brand/ · ui/
  ├── scripts/research/              chat-gpt.ts ← chatgpt.ts · conversation.ts
  · import.ts
  └── docs/
      ├── decisions.md               + naming/layout rules, updated paths
      ├── setups/  clerk.md · hetzner.md
      ├── research/
      └── auth-ui-research-prompts.md · server-backend-plan.md ·
  ssh-authorized-keys.md
          ssh-research-audit.md · ssh-research-prompts.md          (kept until
  the docs pass)

  Tables (named after the thing their rows belong to, not the folder):
  - users, userAccess
  - servers, serverNames, serverMemberships (← serverMembers)
  - serverGrants, serverAllocations, serverOperations
  - serverInventoryScans (← serverInventory), serverInventoryFindings (←
    serverFindings)
  - serverSshAccess

  Public API:
  - api.users.{current, syncCurrent}
  - api.servers.lifecycle.{create, power, remove, status}
  - api.servers.names.{rename, getByName}
  - api.servers.memberships.{list, listMine, add, setPermissions, remove, 
    transferOwnership}

  Everything under allocations/ and ssh/ is internal. File naming for code split
  by runtime: x.ts holds the Node actions, x_state.ts its queries and
  mutations, x_http.ts its HTTP actions.

  If allocations split out later instead: the six allocations/ files would sit
  inside servers/ for now (11 files), and servers/lifecycle.ts would keep the
  provisioning helpers.

  Your decisions

  1. Split allocations now? I recommend yes.
  2. Is the casing rule text above right?
  3. Lint: are the adopt and reject lists right, and type or interface?

  Once you've answered, I'll start step 1 (casing rule, Biome settings, and
  their fixes) and stop there for review.

✻ Churned for 15m 34s · done 12:59 PM

❯ Is there a point in us using separate wording like remove and delete? And why 
  is it, like, reserve and provision, but delete server? Sort of camel case     
  and together like that. Why not reserve server, provision server, delete      
  server, or reserve, provision, delete? Or are these just different external   
  Hetzner provider/TypeScript things? Is there any asymmetry that you might be  
  spotting here, or just in general with nouns like this and just words in      
  general like this? Try to generalize as much as you can. And don't try to     
  come up with an answer that you think is going to make me happy. You can      
  either say everything is already good, or conversely just not. Just try not   
  to overfit to what I'm saying, and try to properly generalize and give me     
  your honest opinion on where there is symmetry, where there might be an       
  asymmetry, and if there is a reason for that. And yeah, I mean, bring up the  
  things that you think I should care about, but don't spam me with, like, a    
  bunch of stuff, I guess. But you should still think about that bunch of       
  stuff, even if you don't mention it to me explicitly in totality.             
                                                                                
  I agree with splitting it all, to be fair. It looks clean in the way that you 
  explained it.                                                                 
                                                                                
  Those casing rules seem pretty reasonable. Maybe it would help to make the    
  examples of SHR, image URL, ChatGPT, and ChatGPT account just be ambiguous    
  sort of random words that aren't tied to the repo, if that makes sense, so    
  the agents are encouraged to generalize better.                               
                                                                                
  If we were to make the biome rules, like strict and stuff, then I feel like   
  an agent instruction to deal with that properly would follow, or would need   
  to follow. Because that would mean a lot of disabling of the rules locally,   
  right? And when there is enough of that in the codebase and agents are        
  reading different files, if it's done haphazardly, then agents might just     
  slap it on everywhere or not really think through what it means when          
  something is ignored and passes checks, if that makes sense. But then again,  
  all rules might just be best, and this might be the best workaround that we   
  have, that we can have. Is there something for me to decide between for this, 
  for the shape of the biome config and how that is going to shape our repo;    
  like clear worlds?                                                            
                                                                                
  The plan structure looks really great. It feels great to look at, just from   
  what I see of the file tree that you suggested.                               

● Before answering I want the whole vocabulary in front of me, not just the
  examples you named. Pulling every function, helper, state, and code name.

● Bash(F=$(git ls-files 'convex/*.ts' 'convex/**/*.ts' 'src/*.tsx'
      'src/**/*.tsx' 'src/*.ts' 'scripts/**/*.ts' | grep -v _generated)
      echo "## exported + local function…)
  ⎿  ## exported + local function-like names (file: name)
     auth.config.ts: clerkFrontendApiUrl
     convex.config.ts: app
     … +66 lines (ctrl+o to expand)

● Bash(mkdir -p tmp/suppress-check && cd tmp/suppress-check && cat > biome.json
      <<'EOF'
      { "root": true, "vcs": {"enabled": false}, "linter": { "rules": {
      "preset": "no…)
  ⎿  t.ts:2:46 suppressions/incorrect ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       ! A suppression shouldn't have an <explanation> placeholder. Example
     … +9 lines (ctrl+o to expand)

● Wording: not already good

  Hardly any of the mismatches have an outside cause. Only two things are
  forced:
  - delete is a reserved word. A Convex function exported as export const delete
    is a syntax error, so registered functions can't use that name.
  - Outside systems keep their own words at the boundary: HTTP DELETE,
    ctx.db.delete, Clerk's user.deleted, and Hetzner's poweron, shutdown, off,
    primary_ips.

  Everything else is drift from different sessions. It follows four patterns:

  1. Two words for one meaning. This is the costly case: readers assume two
  words mean two things, and a search for one word misses the other.
  - remove and delete mean the same thing today.
    - servers.remove, users.remove and the worker's remove all destroy
      something.
    - deleteMembers and removeUserMemberships both delete membership rows.
  - The server create path uses four words: create (the command), provision (the
    helper), allocating (the status), and "provisioning" (the error messages).
  - command and operation: power({ command }) writes to serverOperations.
  - requestKey checks a request ID, in a codebase full of SSH keys.

  Earlier I agreed that one word can have different meanings in different
  places. Two words for the same meaning is the opposite problem, and I'd hold
  firm on fixing it.

  2. Names promise the result instead of saying what the call does. In a system
  where a worker finishes the job later, this invites callers to assume the job
  is done.
  - deleteServer usually doesn't delete anything; it records a delete request.
  - provision inserts rows and queues work.
  - dispatch marks a resource "uncertain" before the request is sent.
  - authorizePower authorizes nothing; it checks and returns a boolean.

  3. Whether a name includes a noun depends on who wrote it.
  - Registered functions setGrant, addMember and syncCurrentUser include a noun.
  - Helpers reserve and provision, which other files import, don't. In
    servers.ts, reserve(ctx, userId) doesn't say what gets reserved.
  - The earlier rule fixes this: registered functions get bare names, and a
    helper imported from another folder includes its noun.
  - My own tree broke that rule: provision sits next to requestPower and
    requestDeletion.

  4. One word with two meanings in the same code. Inside the allocations code,
  "server" means both our server (a.serverId) and the Hetzner VM (find(a, 
  "server")). This is the only such clash worth fixing.

  What's already consistent:
  - State words follow one convention: commands are verbs (create, start, stop,
    forceStop, delete), and states are adjectives or past participles (pending,
    succeeded, present, absent).
  - Error codes all use one format.
  - Helper names come in clear pairs: read/write, parse/render, seal/unseal, and
    prefixes get/list/is/require.

  Proposed word pairs:

  ┌──────────────────────┬──────────────────────────────────────────────────┐
  │        Words         │                     Meaning                      │
  ├──────────────────────┼──────────────────────────────────────────────────┤
  │ create / delete      │ A record or resource starts or stops existing    │
  ├──────────────────────┼──────────────────────────────────────────────────┤
  │ add / remove         │ An item enters or leaves a collection that keeps │
  │                      │  existing (a member, a key line)                 │
  ├──────────────────────┼──────────────────────────────────────────────────┤
  │ reserve / release    │ Capacity is held or given back                   │
  ├──────────────────────┼──────────────────────────────────────────────────┤
  │ start / stop         │ Power                                            │
  ├──────────────────────┼──────────────────────────────────────────────────┤
  │ request…             │ Records intent that a worker finishes later      │
  │                      │ (requestCreate, requestPower, requestDelete)     │
  ├──────────────────────┼──────────────────────────────────────────────────┤
  │ get / list, is,      │ Read one / read many, return a boolean, throw,   │
  │ require, check, set  │ return a failure, replace a value                │
  └──────────────────────┴──────────────────────────────────────────────────┘

  Public functions use the user's command words. Their one forced exception is
  servers.lifecycle.remove, because delete is reserved.

  Other consequences:
  - provision disappears.
  - Allocation statuses become creating/deleting, to match the commands.
  - command becomes operation everywhere.
  - requestKey becomes requireRequestId.
  - Inside allocations code, the Hetzner machine is called vm. Hetzner's server
    stays only in hetzner.ts API paths.

  Casing rule, with neutral examples

  ▎ - "Use one casing policy. Use PascalCase for types, classes, and components.
  ▎ Use camelCase for all other identifiers and for string values that the code
  ▎ defines. Use snake_case for Convex file names, index names, and error 
  ▎ codes. Use kebab-case for all other file names and for CSS. Use 
  ▎ CONSTANT_CASE only for environment variables. Write acronyms as words 
  ▎ (XmlReader, sourceUrl). Split a compound word at the same places in every 
  ▎ casing (webSocket, web-socket). Before you name something, search for that 
  ▎ word in the repository and use its existing spelling. A name from an 
  ▎ external contract keeps its casing."

  Biome: how strict, and where exceptions go

  I tested how Biome treats suppression comments:
  - A suppression with no reason is a parse error.
  - Biome warns on the <explanation> placeholder and on suppressions that no
    longer suppress anything.
  - No rule can forbid suppressions altogether.

  Your existing inviolable rule already requires the narrowest suppression for
  correct code that triggers a false positive.

  There are three possible setups:

  Setup: 1. Lean
  What it does: Turn on only rules with no legitimate exceptions. Magic numbers
  and complexity are checked in review.
  Result: About zero suppressions, but the drift you see today can return.
  ────────────────────────────────────────
  Setup: 2. Strict, exceptions inline
  What it does: Turn on every adopted rule. Each exception is a biome-ignore in
  the code.
  Result: Fully enforced, but suppressions spread and agents copy them.
  ────────────────────────────────────────
  Setup: 3. Strict, exceptions in one place
  What it does: Same rules. Whole-file exceptions for external formats go in
  overrides in biome.json. Inline suppressions only for false positives on
  correct code.
  Result: Fully enforced, and exceptions can be reviewed in one file.

  From the dry run, setup 3 needs overrides only for the 34 external-format
  names. The magic numbers, complexity, parameter counts and missing awaits can
  all be fixed in the code, so I expect close to zero inline suppressions.

  To avoid a new bullet, I'd extend the existing canonical-code rule:

  ▎ "…the narrowest applicable suppression should be used. Fix the code first. 
  ▎ Put an exception that covers a whole file for an external format in the 
  ▎ overrides of biome.json. Give each inline suppression a reason that names 
  ▎ the external constraint."

  Decisions for you

  1. Are the word pairs above right? This includes dropping provision, statuses
     creating/deleting, and vm for the Hetzner machine.
  2. Which Biome setup: 1, 2, or 3? I recommend 3.

  After that I'll start step 1: the AGENTS.md casing and suppression text, the
  Biome settings, and their fixes.

✻ Baked for 3m 20s · done 1:23 PM

❯ I like setup number two, personally. And for the word pairs, is there an      
  alternative, or is this really the best, in your opinion? What about wording  
  like tear down, for example? And why would provision be dropped? Does it get, 
  like, folded? Explain the word pairs and just the whole general set of        
  changes around there, generalized across, like everything you already         
  generalized across. More in detail, please.                                   

● Checking one claim before I use it as evidence: what Convex's own CRUD helper
  calls its delete function, given that delete can't be a variable name.

● Bash(gh api repos/get-convex/convex-helpers/contents/packages/convex-helpers/s
      erver/crud.ts --jq .content | base64 -d | grep -nE
      "^\s+(create|read|update|destroy|del…)
  ⎿  38: * export const { create, read, update, destroy } = crud(schema, "u
     sers");
     104:    create: mutation({
     … +7 lines (ctrl+o to expand)

● Bash(mkdir -p tmp/range-check && cd tmp/range-check && printf '{ "root": true,
      "vcs": {"enabled": false}, "linter": { "rules": { "preset": "none",
      "style": { "useNam…)
  ⎿  t.ts:7:2 lint/style/useNamingConvention ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       × This object property name should be in camelCase.
       × Some errors were emitted while running checks.

● Setup 2 it is. One thing I tested on the installed Biome: range suppressions
  work (// biome-ignore-start <rule>: <reason> … // biome-ignore-end). So one
  external JSON object, such as a Hetzner request body, can carry a single
  suppression around it, not one per field.

  The underlying problem

  The worker only picks up a server some time after it's requested. So each step
  in a server's life is a separate event, happening at a different time:

  user asks ─► intent recorded ─► capacity held ─► provider calls ─► resources
  confirmed ─► capacity given back ─► records deleted

  Today the words don't line up with those events:
  - Several words for one event. The start of a server's life is called create,
    provision, allocating, and "provisioning".
  - One word for several events. deleteServer names the request, but the actual
    deletion happens three events later.

  Every row below follows three principles:

  1. One event, one verb. The noun says which part of the system. You create or
     delete a server, an allocation, a vm, an ipv4. The verb doesn't change
     between parts.
  2. Different events get different verbs, even when they're related. Asking for
     a delete, calling the provider, giving back capacity, and deleting records
     each get their own word.
  3. A name says what's true when the function returns. A function that records
     intent for the worker is named request… plus the command word.

  Why provision goes, and why not the alternatives

  provision has no event of its own. In the code it's the helper that create
  calls to record an operation of kind create. Its allocation then shows status
  allocating. So it's a second word for the same event, and it gets folded into
  requestCreate.

  Alternatives I considered:

  Word pair: create / delete
  Verdict: Recommended. Hetzner, Convex (ctx.db.delete), HTTP (DELETE) and Clerk

  (user.deleted) all use these words, so nothing needs translating anywhere our
   code meets theirs.
  ────────────────────────────────────────
  Word pair: provision / deprovision
  Verdict: Workable second choice, if you want the verb itself to say "machine".

  It adds a second pair for the event users see as "create a server", and it
  would need translating back to create/delete at the Hetzner boundary.
  ────────────────────────────────────────
  Word pair: tear down / teardown
  Verdict: No. It's a phrasal verb (ASD-STE100 avoids those), and it's split
  differently in different places (tearDown vs teardown), which is the casing
  problem again. It also already means test cleanup.
  ────────────────────────────────────────
  Word pair: destroy
  Verdict: No. Terraform and convex-helpers' crud() use it because delete is a
  reserved word, but everything around our code still says delete, so it
  becomes a third synonym.
  ────────────────────────────────────────
  Word pair: allocate / deallocate
  Verdict: No. In Azure, "deallocate" means stopped with disks kept, the
  opposite
  of our meaning. It would also clash with the grant word release.

  reserve / release passes principle 2: capacity is held when the create is
  requested and given back only after resources are confirmed gone. Those are
  different events at different times, so they get different words.

  add / remove stays separate from create / delete because the thing itself
  outlives the action. A user still exists after leaving a server, and an SSH
  key can still exist in another file.

  Full set of changes

  Event or concept: User asks for a server
  Today: create → provision; kind create; status allocating; "Server
  provisioning
  is not enabled"
  Proposed: create → requestCreate; kind create; status creating; "Server
  creation is not enabled"
  ────────────────────────────────────────
  Event or concept: User asks for deletion
  Today: remove → deleteServer, which usually only records a request
  Proposed: remove → requestDelete
  ────────────────────────────────────────
  Event or concept: Power
  Today: power({ command }); statuses running / off
  Proposed: power({ kind }); running / stopped. Hetzner's off gets translated
  where we read it.
  ────────────────────────────────────────
  Event or concept: Worker's provider calls
  Today: create, remove, find; resource kind server
  Proposed: createResource, deleteResource, findResource; kind vm
  ────────────────────────────────────────
  Event or concept: Capacity
  Today: reserve; release written inline as used - 1
  Proposed: reserveGrant, releaseGrant
  ────────────────────────────────────────
  Event or concept: Records deleted after the machine is gone
  Today: inline in record, plus scheduled deleteMembers
  Proposed: servers.lifecycle.deleteRecords
  ────────────────────────────────────────
  Event or concept: Command vs operation
  Today: argument command, message "another command", table serverOperations
  Proposed: "operation" everywhere
  ────────────────────────────────────────
  Event or concept: Request ID check
  Today: requestKey
  Proposed: requireRequestId
  ────────────────────────────────────────
  Event or concept: Host-key registration
  Today: registerSshHost (HTTP), registerHostKey (action), acceptHostKey
  (mutation)
  Proposed: registerHostKey in all three files
  ────────────────────────────────────────
  Event or concept: Queueing work that is due
  Today: schedule (inventory), sweep (allocations)
  Proposed: sweep in both
  ────────────────────────────────────────
  Event or concept: Checks
  Today: dispatch (only marks a resource uncertain), authorizePower (returns a
  boolean)
  Proposed: markUncertain, canSendPower
  ────────────────────────────────────────
  Event or concept: Hetzner response checks (they throw)
  Today: object, list, textField, idField, owned, verifyController
  Proposed: requireObject, requireList, requireText, requireId, requireOwned,
  requireController
  ────────────────────────────────────────
  Event or concept: Memberships
  Today: addMember, removeMember, deleteMembers, removeUserMemberships,
  listMembers, setMemberPermissions
  Proposed: add, remove, removeAll, removeForUser, list, setPermissions
  ────────────────────────────────────────
  Event or concept: Users
  Today: syncCurrentUser, isStored (also checks the user isn't disabled)
  Proposed: syncCurrent, isActive

  Rules the table follows:
  - Function prefixes:
    - is / has / can return a boolean
    - require throws
    - check returns a failure or null
    - get returns one item or null, and list returns many
    - set replaces a value
    - request… records intent for the worker
  - Nouns in names: leave a noun out only when the function's path already
    contains it (api.servers.memberships.add). Keep it otherwise (ssh/bootstrap
    → registerHostKey).
  - State words:
    - A command is a verb: create.
    - Progress is the same verb plus "-ing": creating.
    - Operation outcomes (pending, succeeded, blocked, superseded) and resource
      existence (pending, uncertain, present, absent) are separate axes, and
      both are already consistent.
  - Outside words are translated once, at the boundary. Hetzner's server becomes
    vm, poweron becomes start, off becomes stopped. They don't leak into our
    own state words.

  Two exceptions the language forces:
  - remove in Convex function names. delete can't be a variable name, so the
    Convex functions servers.lifecycle.remove and users.remove use remove.
    Everywhere else, including every plain helper, says delete.
  - claim means two things, in different folders. It means a permanent name
    claim in servers/names.ts and a worker lease in allocations/worker_state.ts.
    That's the kind of context-separated reuse you argued for earlier, so I'd
    leave it.

  The suppression rule for setup 2

  This extends the existing canonical-code bullet in AGENTS.md:

  ▎ "…the narrowest applicable suppression should be used. Fix the code first. 
  ▎ Suppress a rule only for a false positive on canonical code or for a name 
  ▎ from an external contract. Put the suppression on the smallest node, or use 
  ▎ one biome-ignore-start/biome-ignore-end range around a single external 
  ▎ object. Give each suppression a reason that names the external constraint, 
  ▎ and re-check that reason before you copy a suppression elsewhere."

  Your decisions

  1. Word pairs: create/delete as above (my recommendation), or
     provision/deprovision for the machine?
  2. Hetzner's off becomes stopped, and its server becomes vm: yes?

  Once you've answered, I'll start step 1. It covers the casing and suppression
  text in AGENTS.md, the strict Biome settings, and fixes for what they flag.
  The renames above land in step 2, together with the file moves.

✻ Brewed for 2m 39s · done 1:37 PM

❯ Your full set of changes looks actually really good, in my opinion, but       
  explain the change from server to VM, and did you think about the V1 versus   
  V2 shape of Hetzner Cloud versus Hetzner or other provider dedicated slash    
  bare metal compute split out to VPSs or VMs or whatever it will be, and the   
  transition from V1 to V2, basically. Well, it was all, I think, in the        
  conversation that you read earlier, but yeah, I mean you don't have to think  
  about the transition itself. The thing that I want you to maybe think about,  
  if you haven't already considered this, is just what wording will make sense  
  for the things that will be used in V2, the same as in V1, or extended from   
  V1, or changed from V1, basically. If we are to even call it V1 V2 at all.    
  And you're saying Hetzner's Off becomes Stopped. Does that mean Hetzner's Off 
  becomes our Hetzner Stopped, or what? Are you saying we should remap? Is      
  there perhaps a reason that we should preserve the external API naming        
  verbatim and then only make our stuff align to that, or is that going to be   
  hard to enforce? Basically, what makes the most amount of sense, in your      
  opinion? And if there would be a document that you would make based on all of 
  this vocabulary and wording and naming and casing and all these different     
  complex things that can't be represented simply in a rule, then do you think  
  it would be worth making that document?  Does Hetzner have VMs or servers,    
  or?                                                                           

● Searching the Codex thread and the research docs for the V1/V2 and
  dedicated/bare-metal discussion so I'm working from what was actually said.

● Bash(F="C:/Users/sloik/AppData/Local/Temp/claude/C--Users-sloik-Documents-Proj
      ects-composery/fe87350c-d8c9-490b-b23b-7e4ac6a39288/scratchpad/codex-threa
      d.md"; grep -…)
  ⎿  ----
     docs/research/2026-09-13-billing-provisioning-boundary.md
     docs/research/2026-09-13-biome-config-parity-guidance.md
     … +18 lines (ctrl+o to expand)

  Searched for 1 pattern (ctrl+o to expand)

● Bash(sed -n 1,60p docs/research/2026-09-13-design-server-allocation-model.md |
      cut -c1-600; echo .....; sed -n 280,320p
      docs/research/2026-09-13-design-server-alloca…)
  ⎿  # Design Server Allocation Model

     Source: https://chatgpt.com/share/6aa6f4ed-4600-83eb-ad29-2ab62d887be6
     … +98 lines (ctrl+o to expand)

● Fetch(https://docs.hetzner.cloud/reference/cloud)
  ⎿  Received 21.2KB (200 OK)
● Fetch(https://robot.hetzner.com/doc/webservice/en.html)
  ⎿  Received 655KB (200 OK)

● Bash(gh api repos/hetznercloud/hcloud-go/contents/hcloud/server.go --jq
      .content | base64 -d | grep -nE "ServerStatus[A-Za-z]+ +ServerStatus =
      |^// Server represents…)
  ⎿  16:// Server represents a server in the Hetzner Cloud.
     58:        // ServerStatusInitializing is the status when a server is
     initiali
     zing.
     … +26 lines (ctrl+o to expand)

● What Hetzner calls things

  Hetzner's APIs use "server" for every machine you rent, virtual or physical:
  - Hetzner Cloud API: a servers resource. These are virtual machines on
    Hetzner's hardware. The official Go client lists their statuses as
    initializing, starting, running, stopping, off, deleting, migrating,
    rebuilding, unknown. The power actions are poweron, shutdown, poweroff,
    reboot, reset.
  - Hetzner Robot API (dedicated servers): /server, server_number, server_ip.
    These are physical machines, with reset types sw, hw, power, power_long,
    man.

  Why I said vm, and why it's the wrong word

  The goal was to stop "server" meaning two things in the allocation code: our
  product and Hetzner's resource. vm does that for today, but it breaks on the
  later plan. Your earlier research prompt described it as "VMs on dedicated
  hosts, or bare metal", and bare metal isn't a VM.

  Later, "server" would have three meanings: our product, a Hetzner Cloud VM,
  and a Hetzner dedicated machine. So we need a word that covers VMs and bare
  metal.

  My recommendation is machine. Cluster API and MAAS use it for both VMs and
  bare metal.
  - instance clashes with Clerk instances (docs/setups/clerk.md) and with class
    instances.
  - host should be kept for the later physical machine that runs our own VMs.

  Wording across "V1" and "V2"

  "V1/V2" should stay conversation shorthand, not code. The allocation-model
  research argued against a version field, and the code already names the
  backend by how it works: backend: "hetznerCloud". A later backend gets a
  descriptive name too, not v2.

  The test for good wording: later work adds words and never renames existing 
  ones.

  ┌────────────┬───────────────────────┬───────────────┬────────────────────┐
  │            │                       │    Today      │ Later (our hosts / │
  │    Word    │        Meaning        │   (Hetzner    │     bare metal)    │
  │            │                       │    Cloud)     │                    │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │            │ What the customer     │               │                    │
  │ server     │ owns and shares.      │ same          │ same               │
  │            │ Never a provider      │               │                    │
  │            │ thing.                │               │                    │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │            │ One real instance of  │               │                    │
  │ allocation │ a server: the machine │ same          │ same               │
  │            │  behind it, over its  │               │                    │
  │            │ lifetime              │               │                    │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │            │ A recorded command:   │               │ same. Each backend │
  │ operation  │ create, start, stop,  │ same          │  declares which    │
  │            │ forceStop, delete     │               │ commands it        │
  │            │                       │               │ supports           │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │            │ The mechanism that    │               │                    │
  │ backend    │ makes an allocation   │ hetznerCloud  │ new values         │
  │            │ real                  │               │                    │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │ provider   │ The company and API a │ Hetzner       │ Hetzner (Robot     │
  │            │  backend calls        │ (Cloud API)   │ API), others       │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │            │ The computer an       │ a Hetzner     │ a VM on our host,  │
  │ machine    │ allocation runs on    │ Cloud server  │ or a bare-metal    │
  │            │                       │               │ machine            │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │ ipv4, ipv6 │ Public addresses of   │ Primary IPs   │ Robot IPs or       │
  │            │ the allocation        │               │ subnets            │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │ host       │ A physical machine    │ not used yet  │ new                │
  │            │ that runs our VMs     │               │                    │
  ├────────────┼───────────────────────┼───────────────┼────────────────────┤
  │ grant      │ Capacity an operator  │ same          │ same               │
  │            │ allows a user         │               │                    │
  └────────────┴───────────────────────┴───────────────┴────────────────────┘

  Nothing in this table changes meaning later. It only gains host and new
  backend values.

  The verbs hold up too. At our level, a bare-metal allocation is still created
  and deleted. Provider-specific verbs (ordering, installing, wiping a Robot
  machine) stay inside that backend's code, the same way poweron stays inside
  the Hetzner Cloud code today.

  off → stopped: yes, a remap, and here's why

  Our allocation status is our own word. Hetzner's status stays exactly as
  Hetzner writes it, but only inside the Hetzner code. Today the status set
  mixes the two: running and off are copied from Hetzner, while creating,
  deleting, blocked and missing are ours.

  When to use the outside word, and when to define our own:
  - Use the outside word when that one system is the only source of the concept.
    Examples: clerkUserId, ctx.db.delete, the HCLOUD_* env vars.
  - Define our own word when several systems, today or planned, feed one
    concept. Then translate in each backend's code.

  Allocation status is the second case. Hetzner Cloud says off, Robot has no
  such status, and a hypervisor like libvirt says "shut off". There's no single
  outside vocabulary to follow. If we copied Hetzner's, the product status would
  change meaning as soon as a second backend arrives.

  This is easy to enforce with types, no naming discipline needed:
  - The Hetzner code types Hetzner's status union exactly as documented.
  - One function maps it to our status with an exhaustive switch.
  - The allocation status validator only accepts our words.

  If Hetzner adds a status, the switch stops compiling, so nothing slips through
  silently.

  Our status set follows the command verbs: start/stop → starting/stopping →
  running/stopped. That's Hetzner's own pattern except for off, and it matches
  AWS's stopped.

  What this changes in the planned tree

  Files that only work with Hetzner Cloud should say so in their path now.
  Otherwise, adding a second backend means renaming function paths while jobs
  are queued, which is the migration cost we're avoiding.

  convex/allocations/
  ├── grants.ts                reserveGrant · releaseGrant · set
  ├── operations.ts            requestCreate · requestPower · requestDelete ·
  getStatus
  └── hetzner_cloud/           (the folder name matches backend "hetznerCloud"
  and the HCLOUD_* env vars)
      ├── api.ts               ← hetzner.ts: request, require* response checks,
  status mapping
      ├── inventory.ts
      ├── worker.ts            run  ("use node")
      └── worker_state.ts      sweep · claim · markUncertain · canSendPower ·
  record · retry

  Two more renames follow:
  - Rate-limit keys: providerRequest and providerCleanup become
    hetznerCloudRequest and hetznerCloudCleanup. The Robot API has its own
    limits.
  - Resource-kind label: the value server becomes machine. This only affects dev
    resources.

  A vocabulary document: yes, with limits

  A rule can't catch synonyms. Searching the repo for provision won't tell an
  agent to use create, and searching for vm won't tell it vm was rejected. So
  the chosen and rejected words need to be written down somewhere.

  Conditions I'd hold it to:
  - One file: docs/vocabulary.md, about 60 lines, tables first.
  - Columns: term, meaning, and rejected synonyms with the reason.
  - Content: the layer words above, the verb pairs, the state-word pattern, the
    rule for outside vs our own words, and the reserved-word exception for
    remove.
  - One line in AGENTS.md telling agents to use those words.
  - No duplication: the existing line in decisions.md ("The code and product
    copy use the same term, name") moves into it, so the two files don't
    overlap.
  - Updated with the code: it changes in the same commit as any vocabulary
    change. It describes current state, like decisions.md.

  What it won't hold: anything a lint rule or the type system already enforces,
  and any per-function naming. The code itself shows those.

  Your decisions

  1. Is machine the right word for the compute behind an allocation?
  2. Should the hetzner_cloud/ subfolder happen now, as part of the move?
  3. Should docs/vocabulary.md be written in step 1, together with the AGENTS.md
     casing and suppression text?

✻ Cogitated for 2m 46s · done 1:45 PM

❯ Just so we're clear, when we add the dedicated shape later, then each         
  dedicated thing will have probably the capacity to serve, like, multiple      
  servers, right? Maybe we use, like, Kubernetes or maybe something else, but,  
  like, that's the idea. It's not, like, users are gonna get, like, each        
  dedicated thing, like they are currently getting a cloud server, each mapping 
  one to one. Basically, it's not necessarily going to map one to one for V2.   
  And on the vocabulary sort of policy and just document in general and         
  everything that, you know, the repo is gonna comprise of ultimately, I think  
  that we should only land on a policy that is really just clearly expressible  
  and generalizable. And it's not like we randomly just decided this one day to 
  do this one word, to use this one wording, to remap this one thing, to not    
  remap the other thing, and then that can't be easily expressed without        
  literally tying it to an example, which would ruin generalization, if that    
  makes sense. So, like, does everything hold up in terms of that out of the    
  things that we are planning? And yes, should the cloud Hetzner, or Hetzner    
  Cloud subfolder happen now as a part of the move? I'm not going to give an    
  answer on that, but what I am going to say is yes, I do want the codebase to  
  be in a shape where it can nicely move over to v2 later on without making v1  
  feel like it's a piece of throwaway gunk, if that makes sense. I don't know   
  how to explain it, but, like, I want both to hold up. And when both exist,    
  because there will be a period of time where both exist, the codebase won't   
  be cluttered and messy. So I think we do have to design for that, at least in 
  part, if not fully, already. And yeah, I think vocabulary should be written   
  in step one. However, that's not saying that we are yet clear on what to even 
  write and whether we want to begin step one yet, but I think we are fairly    
  close. I just want a generalized review of everything in terms of how it      
  would map to a given policy, and if the policy would be clear-worded enough,  
  and terse and concise, yet perfectly understandable and comprehensible and    
  maintainable, but hopefully not needing to be constantly changed and tweaked  
  and maintained and just rethought, because that's going to introduce failures 
  of its own. Of course, we're not prohibiting maintaining, but what I'm        
  basically trying to say is that it should be good from the get-go so that it  
  doesn't need to be maintained all that much, if at all. But it still          
  enforces, like, sort of strict things, and we do use things like Biome for,   
  like, programmatic sort of enforcement of some of these things without, like, 
  I guess making stuff feel sloppy, I guess. Oh, also on the topic of just      
  slop, I would like you to take a look at this script and maybe introduce it   
  into this repo. And yeah, take a look at the package.json. This script is     
  taken from another project, and it might address some of the things and might 
  set a precedent for how we may deal with wording and vocabulary and scripts   
  in the repo in general. But I would prefer if most things are, like, simple,  
  easy-to-understand rules instead of walls of TypeScript, which are in and of  
  themselves even harder to interpret and maintain, for example, for a human    
  like me.  c:\Users\sloik\Documents\Projects\composery-2\scripts\slop.ts       
  c:\Users\sloik\Documents\Projects\composery-2\scripts\package.json            
  c:\Users\sloik\Documents\Projects\composery-2\package.json Try not to inherit 
  any of the bad patterns from that repo that is older and really wasn't taken  
  care of. Try to not ingest any of the code, I would say, or be stringent      
  about everything that you ingest instead of bringing it over one to one. I    
  would rewrite it from scratch while learning from the actually decent bits, I 
  suppose.                                                                      

● Bash(cd /c/Users/sloik/Documents/Projects/composery-2 && wc -l scripts/slop.ts
      scripts/package.json package.json && cat scripts/package.json
      package.json)
  ⎿    363 scripts/slop.ts
        14 scripts/package.json
        39 package.json
     … +54 lines (ctrl+o to expand)
  ⎿  Shell cwd was reset to C:\Users\sloik\Documents\Projects\composery

  Read 1 file (ctrl+o to expand)

● Bash(P=$'[‘’“”…–—− ]'
      echo "== occurrences by area (tracked files)"; git grep -c -P "$P" -- .
      ':!bun.lock' 2>/dev/null | awk -F: '{split($1,a,"/"); k=(a[1]=="docs"&…)
  ⎿  == occurrences by area (tracked files)
     552 docs/research
     30 docs/ssh-research-prompts.md
     … +24 lines (ctrl+o to expand)

● Bash(git grep -n -P $'[‘’“”…–—− ]' -- AGENTS.md docs/ssh-authorized-keys.md
      docs/ssh-research-audit.md convex/_generated/ai/guidelines.md | cut
      -c1-220; grep -n "ge…)
  ⎿  AGENTS.md:1:<!-- BEGIN:nextjs-agent-rules -->
     AGENTS.md:3:# This is NOT the Next.js you know
     AGENTS.md:5:This version has breaking changes — APIs, conventions, and
     … +426 lines (ctrl+o to expand)

● Bash(P='[\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}\x{2013}\x{2014}\x{2212}\x{00
      A0}\x{200B}]'
      echo "== counts by file (outside docs/research)"; git grep -c -P "$P" --…)
  ⎿  == counts by file (outside docs/research)
     AGENTS.md:3
     convex/_generated/ai/guidelines.md:4
     … +29 lines (ctrl+o to expand)

● Bash(F=node_modules/next/dist/server/lib/generate-agent-files.js; wc -l $F;
      grep -nE "BEGIN|END|includes\(|indexOf|replace\(|writeFile|===|!==" $F |
      head -40)
  ⎿  179 node_modules/next/dist/server/lib/generate-agent-files.js
     13:    AGENT_RULES_END_MARKER: null,
     25:    AGENT_RULES_END_MARKER: function() {
     … +29 lines (ctrl+o to expand)

● Dedicated hosts with many servers per host: does the model hold?

  It holds, but it exposes a mistake in my last answer, and fixing it makes
  things simpler.

  Why it holds: the product side never assumes one allocation equals one
  machine.
  - A server is what the customer owns.
  - An allocation is the one thing behind it that's running right now.
  - An operation is a recorded command.
  - A grant is capacity.

  All four mean the same whether the allocation is a Hetzner Cloud VM, one of
  many workloads on a shared dedicated host, or a bare-metal machine. Only the
  Hetzner Cloud code assumes one allocation per machine.

  What was wrong: I tried to find our own word for "the compute" (vm, then
  machine). With many workloads per host (Kubernetes or otherwise), that thing
  could be a VM, a pod, or a slice of a host, so any word I pick now is a guess.
  The general answer is that we don't need a word for it at all:
  - Inside the Hetzner Cloud code: Hetzner's words, as Hetzner writes them
    (server, primary_ip, off).
  - Outside it: only our words (server, allocation, operation, status).

  A later backend's code uses its own words (Robot's server, Kubernetes' node
  and pod), and nothing outside it changes.

  One fix this requires: today the Hetzner worker's record also releases the
  grant, deletes the server rows, and deletes the SSH credential. Those steps
  apply to every backend, so they move into allocations/operations.ts, and each
  backend calls them. After that, the Hetzner Cloud code never touches our
  serverId, so "server" inside it only ever means Hetzner's server. Two backends
  existing at the same time then don't duplicate that logic.

  A policy that doesn't need per-example rules

  Your test was: every rule is stated as a category, never as an example. The
  split that passes it:
  - AGENTS.md holds rules. They should rarely change.
  - docs/vocabulary.md holds the words we chose. It changes only when a new
    domain concept appears, such as a later "host".

  Draft rules for AGENTS.md (inviolable section):

  ▎ - "Use one casing policy. Use PascalCase for types, classes, and components.
  ▎ Use camelCase for all other identifiers and for string values that the code
  ▎ defines. Use snake_case for Convex file names, index names, and error 
  ▎ codes. Use kebab-case for all other file names and for CSS. Use 
  ▎ CONSTANT_CASE only for environment variables. Write acronyms as words 
  ▎ (XmlReader, sourceUrl). Split a compound word at the same places in every 
  ▎ casing (webSocket, web-socket). A name from an external contract keeps its 
  ▎ casing."
  ▎ - "Use the words in docs/vocabulary.md. Give each meaning one word within a 
  ▎ file, and each word one spelling everywhere. Add a new concept to the 
  ▎ vocabulary before you use it."
  ▎ - "Code that talks to an external system stays in a folder named for that 
  ▎ system and uses that system's words and values. All other code uses our 
  ▎ words. Translate between the two in that folder."
  ▎ - "A name states what is true when the call returns. A registered Convex 
  ▎ function leaves out what its path already states. Every other export states 
  ▎ it."
  ▎ - "Group files by domain. A folder holds at least two files. A file name 
  ▎ does not repeat its folder name. A table name is the plural of what one row 
  ▎ is."
  ▎ - "Authored text uses ASCII quotes, apostrophes, ellipses, and spaces, and 
  ▎ no dashes as punctuation. Text that a tool writes or that we import keeps 
  ▎ its characters."
  ▎ - (the setup 2 suppression text, appended to the existing canonical-code 
  ▎ bullet)

  Outline of docs/vocabulary.md, all tables:
  1. Domain nouns: server, name/claim, membership, owner, permission, grant,
     allocation, operation, backend, provider, user. Each has a meaning and the
     rejected synonyms (provision, command, member used for the row).
  2. Verb pairs: create/delete, add/remove, reserve/release, start/stop,
     request….
  3. Name prefixes: is/has/can, require, check, get/list, set, request.
  4. State words: a command verb, then its -ing form, then the outcome. Resource
     existence uses a separate set of words.
  5. Language substitutes: remove where JavaScript forbids delete as a name.

  Does every planned change follow from a rule?

  I went through every change so far. Each follows from one of the rules above:

  ┌───────────────────────────────────────────┬─────────────────────────────┐
  │                  Change                   │       Rule it follows       │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ server_* → servers/*; names.ts →          │ domain folders; files don't │
  │ servers/names.ts                          │  repeat the folder name     │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ limits.ts → rate_limits.ts                │ one word, one meaning per   │
  │                                           │ file (limit had two)        │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ provision → requestCreate; deleteServer → │ vocabulary; names state     │
  │  requestDelete; command → operation       │ what's true on return       │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ requestKey → requireRequestId;            │                             │
  │ authorizePower → canSendPower; object →   │ name prefixes               │
  │ requireObject                             │                             │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ Host-key registration → one verb in all   │                             │
  │ three files; schedule and sweep → one     │ one word per meaning        │
  │ verb                                      │                             │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ addMember → memberships.add;              │ Convex functions leave out  │
  │ syncCurrentUser → syncCurrent             │ what the path states        │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ serverMembers → serverMemberships;        │ table = plural of one row;  │
  │ serverInventory and serverFindings →      │ system-specific code named  │
  │ hetznerCloudScans, hetznerCloudFindings   │ for the system              │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ Hetzner's off stays inside the Hetzner    │ outside words stay inside   │
  │ Cloud code; our status says stopped       │ their folder                │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ vm/machine withdrawn; Hetzner's server    │ same rule                   │
  │ stays inside its folder                   │                             │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ Hetzner pacing limits move into           │ system-specific code lives  │
  │ hetzner_cloud/                            │ in the system's folder      │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ remove for exported Convex functions that │ language substitute (listed │
  │  delete                                   │  in the vocabulary)         │
  ├───────────────────────────────────────────┼─────────────────────────────┤
  │ CONSTANT_CASE → camelCase                 │ casing                      │
  └───────────────────────────────────────────┴─────────────────────────────┘

  Two items don't fit a rule cleanly yet:
  - serverSshAccess. Under the table rule it would become allocationSshAccess,
    since each row belongs to an allocation. It's the other agent's table, so
    I'd confirm before renaming.
  - Choosing which synonym wins (sweep over schedule) is taste. The rules only
    require consistency, and the vocabulary file records the choice.

  How both backends would sit side by side

  convex/allocations/
  ├── grants.ts            reserveGrant · releaseGrant · set
  ├── operations.ts        requestCreate · requestPower · requestDelete ·
  getStatus · the shared deletion steps
  │                        (dispatch uses an exhaustive switch on
  `allocation.backend`)
  ├── hetzner_cloud/       api.ts · inventory.ts · worker.ts · worker_state.ts
  └── <later backend>/     its own files, including hosts and placement if it
  has them

  What a later backend adds:
  - a new backend value
  - one new member in the allocation validator (existing rows stay valid)
  - one new case in each exhaustive switch; the compiler lists every place that
    needs one
  - a sibling folder

  What changes in existing Hetzner Cloud code: nothing is renamed.

  SSH carries over: it already works per allocation and receives an address and
  port, so an allocation on a shared host fits.

  The slop.ts script

  The rule is worth having. It's the "one spelling" rule applied to characters.
  caller's and caller’s look the same but don't match in a search, and a copied
  command with curly quotes breaks in a shell. Biome's noIrregularWhitespace
  (already on) only covers code, and Biome doesn't check Markdown, so a script
  is the only way to enforce it there.

  Where these characters actually appear in the repo today:

  ┌──────────────────────────────────┬───────┬──────────────────────────────┐
  │             Location             │ Count │         Who wrote it         │
  ├──────────────────────────────────┼───────┼──────────────────────────────┤
  │ docs/research/ (40 files)        │ 552   │ imported conversations       │
  ├──────────────────────────────────┼───────┼──────────────────────────────┤
  │ The two *-prompts.md docs        │ 42    │ to be deleted later          │
  ├──────────────────────────────────┼───────┼──────────────────────────────┤
  │ convex/_generated                │ 4     │ generated                    │
  ├──────────────────────────────────┼───────┼──────────────────────────────┤
  │ AGENTS.md                        │ 3     │ 2 in the Next.js block, 1 in │
  │                                  │       │  your rules (doesn’t)        │
  ├──────────────────────────────────┼───────┼──────────────────────────────┤
  │ ssh-authorized-keys.md,          │ 2     │ authored                     │
  │ ssh-research-audit.md            │       │                              │
  ├──────────────────────────────────┼───────┼──────────────────────────────┤
  │ Code                             │ 0     │                              │
  └──────────────────────────────────┴───────┴──────────────────────────────┘

  Tool-written text must be skipped, not fixed. Next.js writes the em dashes
  itself (they're in generate-agent-files.js), and on every next dev it replaces
  its block whenever the content differs. A fixer that touches that block would
  fight the tool on every run.

  Worth keeping from the old script:
  - a check mode and a fix mode
  - listing files through git ls-files
  - skipping binary files and invalid UTF-8
  - file:line:column output that says what to replace

  Worth dropping:
  - The Biome glob matcher it re-implements. Biome doesn't check Markdown, so
    the two lists never described the same files.
  - Its own ignore-comment syntax. It only exists because the character table
    contains the literal characters; writing them as \u escapes removes the
    need.
  - The 32-worker pool and 4 MiB budget: nothing close to needed for a repo this
    size.
  - CONSTANT_CASE names.

  A rewrite of about 50 lines:
  - Name: scripts/characters.ts, with check:characters and fix:characters.
    "Slop" is slang.
  - What it skips: a short path list (convex/_generated, docs/research), plus
    blocks between <!-- BEGIN:… --> and <!-- END:… --> markers, which is how
    Next.js and Convex mark their tool-managed blocks.
  - What it fixes: only replacements that mean the same thing (quotes,
    apostrophes, ellipses, spaces). Dashes are reported but not fixed, because a
    sentence joined with a dash needs rewording, not a hyphen.
  - The fix script: bun --sequential "fix:*", with fix:characters declared
    before fix:biome, so the two fixers never write the same file at once.
    That's still a fan-out.

  Your decisions

  1. Is the policy text above right, in wording and scope?
  2. Is the script plan right (name, what it skips, dashes reported rather than
     fixed)?
  3. Your own blocks in AGENTS.md (inviolable-agent-rules,
     blessed-agent-behaviors) use the same BEGIN/END markers as the tool blocks.
     For the "marked blocks are tool-written" skip to work, I'd remove the
     markers from your blocks. OK?

✻ Worked for 7m 14s · done 2:08 PM

❯ For server SSH access, you don't have to confirm, just apply the rule. We     
  want consistency. Agents will adapt. For choosing which synonym wins, I think 
  we just do whatever is closest to STE, or is just most intuitive, I guess.    
                                                                                
  Also, for "  - What it skips: a short path list (convex/_generated,           
  docs/research), plus blocks between <!-- BEGIN:… --> and <!--                 
      END:… --> markers, which is how Next.js and Convex mark their             
  tool-managed blocks." - for convex, I actually hand-edited the blocks to use  
  the BEGIN:... END:... sort of shape, so that it would align with next.js. Did 
  the same for the other tags. I feel like ignoring case by case locally,       
  similar to biome, or whatever the \u thing you mentioned actually meant,      
  would be better than skipping things from within the file itself. I'd still   
  like to keep the machinery clean and working though                           
                                                                                
  And that being said, Convex doesn't really seem to rewrite that managed       
  block. Maybe it's just a one-off setup type of thing. And if it really        
  doesn't and it's not going to rewrite it, then a case could be made that we   
  can still keep that sort of skip the blocks with markers type of rule. But,   
  like, I feel like it should be a separate decision. It should at most just be 
  because we have that type of format for markers present in the repo rather    
  than because tooling supposedly uses it. And in general, I feel like that     
  would feel worse off on the code side of things to have, like, these specific 
  cases, like these markers, for example, rather than one-off local ignores,    
  like, for example, biome would. And also this skip marker or skip block with  
  markers rule would skip the agent instructions outside of the managed blocks  
  since I also denote them by these markers, since I think it just helps AI     
  models comprehend the instructions better as well, not just allows them to be 
  managed via tooling.                                                          
                                                                                
  Yeah, I mean, I think this proposed shape you keep refining is at this point  
  just honestly almost perfect and just fantastic in terms of what we can do to 
  improve the code base. It's really good in my opinion. Maybe some of the      
  examples could benefit from, or some of the rules could benefit from a few    
  examples, but only where it would be non— like it would be different from the 
  code base state, so it doesn't feel tied to it, and only where it would not   
  impede generalization and would only fuel it or power it or help the agent    
  understand what a given rule means. Because agents can just skip certain      
  rules if they are not obviously applicable to things enough, or they may feel 
  that they have no obligation to adhere to the rules if they are not clear     
  enough. And so there's an aspect of, like, a little bit of, like, reward      
  hacking there, or, like, just getting the task to be completed, or, like,     
  laziness, so to speak. But, yeah, models don't really suffer from laziness, I 
  think.                                                                        

● Checking two things before answering. First, whether next dev replaces only
  the text between its markers, so an ignore range placed around the block would
  survive. Second, whether the Convex CLI ever rewrites its AGENTS.md block.

● Bash(sed -n 144,160p
      node_modules/next/dist/server/lib/generate-agent-files.js; echo "== convex
      CLI"; grep -rlE "AGENTS\.md" node_modules/convex/dist/cli.bundle.cjs…)
  ⎿  }
     function upsertAgentRulesBlock(existing, block) {
         const eol = detectEol(existing);
     … +16 lines (ctrl+o to expand)

  Searched for 1 pattern (ctrl+o to expand)

● Applied

  - serverSshAccess → allocationSshAccess. Each row belongs to an allocation.
  - Choosing between synonyms is now part of the vocabulary rule: the shorter,
    more common word with one meaning, which is how ASD-STE100 chooses.
  - Clerk code moves out of users.ts. Applying the external-system rule showed
    that users.ts mixes Clerk API calls with our own user data. It splits into:
    - users.ts: our data (current, store, disable, remove, isActive).
    - clerk.ts: everything that talks to Clerk (the client, sync, reconcile, and
      the webhook verification that now sits in http.ts). http.ts then only
      routes requests, the same way ssh/bootstrap_http.ts works.

  The character check: exceptions work like Biome's

  No skipping of marked blocks, and no special cases for BEGIN/END markers.
  There are two levels, the same two Biome has:

  1. Whole files a tool regenerates or we import: convex/_generated and
     docs/research. These are left out of the file list with git pathspecs
     (':!docs/research'), the same idea as !convex/_generated in biome.json. A
     local ignore comment can't work there, because the tool rewrites the whole
     file.
  2. Everything else gets local ignores with a reason:
     - characters-ignore: <reason> covers the next line.
     - characters-ignore-start: <reason> … characters-ignore-end covers a range.
     - A directive counts only when it's the whole content of a comment line, so
       a string that mentions it isn't treated as a directive.
     - A missing reason, an unclosed range, or an ignore that suppresses nothing
       is an error. That last one matches Biome's unused-suppression warning.

  What "the \u thing" means: in TypeScript, "\u2019" writes the character ’ by
  its code point, so the source file stays plain ASCII. Code that needs one of
  these characters, such as the script's own replacement table, a test, or a
  parser, uses the escape and needs no ignore comment. The Convex CLI does this
  itself ("\u2014" in its messages). Markdown has no equivalent, so prose that
  really needs the character uses an ignore comment.

  The Next.js block: I checked upsertAgentRulesBlock. It replaces only the text
  between its own markers and keeps everything before and after. So one ignore
  range placed around the block, outside Next's markers, stays in place when
  next dev rewrites the block:

  <!-- characters-ignore-start: next dev writes this block -->
  <!-- BEGIN:nextjs-agent-rules -->
  …
  <!-- END:nextjs-agent-rules -->
  <!-- characters-ignore-end -->

  About the Convex block: the CLI only writes AGENTS.md when someone runs npx 
  convex ai-files install or update. It finds its block by <!-- convex-ai-start 
  --> and <!-- convex-ai-end -->. With your renamed markers, ai-files status
  will report the section as missing, and update would append a second copy.
  Nothing happens unless someone runs one of those commands.

  The script:
  - Files checked: tracked and untracked files that aren't gitignored, minus the
    two pathspecs. Binary files and invalid UTF-8 are skipped.
  - Output: file:line:column and the replacement.
  - Fixes: quotes, apostrophes, ellipses and spaces are replaced. Dashes are
    only reported, because the sentence needs rewording.
  - Size and form: one file of plain functions, around 90 lines.
  - The fix script: it runs with --sequential, and the character fixer goes
    before Biome, so two fixers never write the same file at once.

  Final policy text for AGENTS.md

  The examples are deliberately unrelated to this codebase.

  ▎ - "Use one casing policy. Use PascalCase for types, classes, and components.
  ▎ Use camelCase for all other identifiers and for string values that the code
  ▎ defines, such as status: "inProgress". Use snake_case for Convex file 
  ▎ names, Convex index names, and error codes. Use kebab-case for all other 
  ▎ file names and for CSS. Use CONSTANT_CASE only for environment variables. 
  ▎ Write acronyms as words: XmlReader, sourceUrl. Split a compound word at the 
  ▎ same places in every casing: webSocket, WebSocket, web-socket. Before you 
  ▎ name something, search the repository for the word and use its existing 
  ▎ spelling. A name from an external contract keeps its casing."
  ▎ - "Use the words in docs/vocabulary.md. Do not use two words for one meaning
  ▎ anywhere, such as fetch and load for one action. Do not use one word for 
  ▎ two meanings in one file. When two words fit, use the shorter, more common 
  ▎ word with one meaning, as ASD-STE100 does: start, not initiate. Add a new 
  ▎ concept to the vocabulary before you use it."
  ▎ - "Code that talks to an external system lives in a file or folder named for
  ▎ that system. Inside it, use that system's words and values. Outside it, use
  ▎ only our words. Translate at that boundary: stripe/ can read status === 
  ▎ "succeeded" and return our paid."
  ▎ - "A name states what is true when the call returns: refund has moved the 
  ▎ money, and requestRefund has only recorded the request. A registered Convex 
  ▎ function omits what its path states: api.invoices.send, not 
  ▎ api.invoices.sendInvoice. Every other export states it, because callers 
  ▎ import it by name: sendInvoice."
  ▎ - "Group files by domain. Outside framework-defined folders, such as Next.js
  ▎ routes, a folder holds at least two files. A file name does not repeat its 
  ▎ folder name: billing/invoices.ts, not billing/billing_invoices.ts. A table 
  ▎ name is the plural of what one row is: invoiceLines."
  ▎ - "When behavior depends on a kind, switch on that kind exhaustively, so 
  ▎ that a new kind does not compile until every place handles it."
  ▎ - "Authored text uses ASCII quotes, apostrophes, ellipses, and spaces, and 
  ▎ no dashes as punctuation. Code that needs one of these characters writes an 
  ▎ escape, such as \u2019. Generated and imported files keep their characters. 
  ▎ bun run check:characters enforces this."
  ▎ - Appended to the canonical-code bullet: "…the narrowest applicable 
  ▎ suppression should be used. Fix the code first. Suppress a check only for a 
  ▎ false positive on canonical code or for a name from an external contract. 
  ▎ Put the suppression on the smallest node, or one range around one external 
  ▎ object. Give it a reason that names the constraint, such as // biome-ignore 
  ▎ lint/style/useNamingConvention: the payment API requires snake_case. This 
  ▎ applies to every check, including characters-ignore. Check the reason again 
  ▎ before you copy a suppression."

  Step 1, when you say go

  Step 1 covers:
  - the AGENTS.md text above
  - docs/vocabulary.md
  - the strict Biome settings
  - scripts/characters.ts and the package scripts
  - fixes for everything those checks flag

  Step 2 (moves and renames) should follow straight after, before other agents
  work in the repo, so the vocabulary document isn't describing words the code
  doesn't use yet.

✻ Cooked for 3m 51s · done 2:26 PM

❯ Well, first of all, we are going to have certain things like building, for    
  example. So the examples will then collide. But maybe it's still fine to have 
  them if it's not going to be one to one. But we are obviously going to add    
  Stripe eventually, right? So you're kind of overfitting right now. And second 
  of all, I would like you to do just one more pass over everything, literally  
  every single thing, to make sure that everything aligns with the principles   
  and values that we have distilled in this conversation into this nice set of  
  rules. Since I just noticed that, or I saw in your latest response that you   
  just noticed that this pattern also applies to Clerk. And now I'm wondering   
  what else would it apply to? Because the fact that you applied it to Clerk is 
  impressive, and I like that. But it makes me wonder if we should dedicate     
  some more reasoning effort, some more thinking to applying these principles   
  generally to the things that currently exist.                                 

● You're right about the examples. Billing and Stripe are coming, so any example
  from those areas will eventually sit right next to real code. I'll pick an
  area the product will never have.

  For the full pass, I've read most files already, but not every line of the
  larger SSH modules, the embedded script, the tests, the skills, or the
  committed schema. Reading those now so nothing is judged from memory.

● Bash(cat convex/ssh/authorized_keys.ts; sed -n 60,149p
      convex/ssh/read_file.ts; sed -n 50,127p convex/ssh/write_file.ts; sed -n
      60,119p convex/ssh/inspect_key.ts)
  ⎿  /**
      * Lossless file observations and candidate edits, without I/O or auth
     orization.
     … +576 lines (ctrl+o to expand)

● Bash(cat convex/ssh/write_file_script.ts; sed -n 1,80p
      convex/ssh/authorized_keys.test.ts; cat convex/schema.ts
      convex/ssh/bootstrap_state.ts convex/auth.config.ts;…)
  ⎿  /** Fixed remote Linux program. Requests arrive on stdin, never as she
     ll code. */
     export const writeFileScript = `import base64, errno, fcntl, json, os,
     … +530 lines (ctrl+o to expand)

● Bash(git grep -ohE "(process\.)?env\.[A-Z_]+" -- 'convex/*.ts'
      'convex/**/*.ts' 'src/**' 'next.config.ts' 'scripts/**'
      ':!convex/_generated' | sed 's/process\.//' |…)
  ⎿        2 env.CLERK_FRONTEND_API_URL
           1 env.CLERK_SECRET_KEY
           1 env.CLERK_WEBHOOK_SIGNING_SECRET
     … +27 lines (ctrl+o to expand)

● Examples replaced, and a full pass done. I read every file under convex/,
  src/, scripts/ and .agents/, plus the configs and non-research docs, and
  applied each rule to all of them.

  Examples moved to an unrelated domain

  Every example now comes from a library book-lending app, which Composery will
  never contain. Applying the rules to Clerk also exposed two gaps, fixed here:
  - What "external system" means. The test is now translation, not mere use of
    an SDK.
  - Function names must start with a verb. Nouns like current, status, space and
    object showed the gap.

  ▎ - "Use one casing policy. Use PascalCase for types, classes, and components.
  ▎ Use camelCase for all other identifiers and for string values that the code
  ▎ defines, such as status: "onHold". Use snake_case for Convex file names, 
  ▎ Convex index names, and error and reason codes, such as "loan_expired". Use 
  ▎ kebab-case for all other file names and for CSS. Use CONSTANT_CASE only for 
  ▎ environment variables. Write acronyms as words: XmlReader, sourceUrl. Split 
  ▎ a compound word at the same places in every casing: webSocket, WebSocket, 
  ▎ web-socket. Before you name something, search the repository for the word 
  ▎ and use its existing spelling. A name from an external contract keeps its 
  ▎ casing."
  ▎ - "Use the words in docs/vocabulary.md. Do not use two words for one meaning
  ▎ anywhere, such as borrow and checkOut for one action, or state and status 
  ▎ for one kind of value. Do not use one word for two meanings in one file. 
  ▎ When two words fit, use the shorter, more common word with one meaning, as 
  ▎ ASD-STE100 does: start, not initiate. Add a new concept to the vocabulary 
  ▎ before you use it."
  ▎ - "Code that translates between our data and an external system's data, such
  ▎ as API responses, webhooks, remote commands, and file or configuration 
  ▎ formats, lives in a file or folder named for that system. Inside it, use 
  ▎ that system's words and values. Outside it, use only our words: isbndb/ can 
  ▎ read "on_shelf" and return our available. Using a framework or library is 
  ▎ not translation."
  ▎ - "A function name, except a component's, starts with a verb: getLoan, not 
  ▎ loan. A name states what is true when the call returns: renew has extended 
  ▎ the loan, and requestRenewal has only recorded the request. A registered 
  ▎ Convex function omits what its path states: api.loans.renew, not 
  ▎ api.loans.renewLoan. Every other export states it, because callers import it
  ▎ by name: renewLoan."
  ▎ - "Group files by domain. Outside framework-defined folders, such as Next.js
  ▎ routes, a folder holds at least two files. A file name does not repeat its 
  ▎ folder name: lending/loans.ts, not lending/lending_loans.ts. When Convex 
  ▎ requires one concern to span runtimes, name its files <concern>.ts for Node 
  ▎ actions, <concern>_state.ts for queries and mutations, and <concern>_http.ts
  ▎ for HTTP actions. A table name is what one row is, plural when the noun has
  ▎ a plural: loanRenewals."
  ▎ - "When behavior depends on a kind, handle every kind explicitly, with a 
  ▎ switch that ends in a never check or a Record keyed by the kind, so that a 
  ▎ new kind fails to compile until every place handles it."
  ▎ - "Authored text uses ASCII quotes, apostrophes, ellipses, and spaces, and 
  ▎ no dashes as punctuation. Code that needs one of these characters writes an 
  ▎ escape, such as \u2019. Generated and imported files keep their characters. 
  ▎ bun run check:characters enforces this."
  ▎ - Appended to the canonical-code bullet: "…Fix the code first. Suppress a 
  ▎ check only for a false positive on canonical code or for a name from an 
  ▎ external contract. Put the suppression on the smallest node, or one range 
  ▎ around one external object. Give it a reason that names the constraint, such
  ▎ as // biome-ignore lint/style/useNamingConvention: the ISBNdb API requires 
  ▎ snake_case. This applies to every check, including characters-ignore. Check 
  ▎ the reason again before you copy a suppression."

  What the pass found beyond the current plan

  Casing
  - AuthButton intents "sign-in" / "sign-up" become signIn / signUp.
  - chatgpt.ts and CHATGPT_SHARE_URL become chat-gpt.ts and chatGptShareUrl,
    matching readChatGptShare.
  - SSH bootstrap error codes lose their ssh_ prefix. SshError codes don't have
    one, and codes shouldn't repeat their domain.
  - Error codes with a variable part (create_outcome_unknown:ipv4,
    server_state:starting) become fixed codes. The variable part moves to its
    own field, so the codes form a closed set the UI can handle exhaustively.

  Two words for one meaning
  - state, status and phase all mean "current condition" (operation state,
    allocation status, resource phase). They become status.
  - seal / unseal / sealedCredential in code versus "encrypt" in the docs become
    encrypt / decrypt / encryptedCredential.
  - leaseUntil sits next to bootstrapExpiresAt, so it becomes leaseExpiresAt.
  - isStored: my earlier fix, isActive, would add "active" as a third word next
    to disable/disabled.
    - The userAccess table only ever holds disabled: true, so it becomes
      disabledUsers. A row existing means the user is disabled.
    - isStored becomes isEnabled.
  - Smaller ones:
    - problem becomes failure (same file uses both).
    - The cron label "reconcile servers" describes a sweep, so "reconcile" is
      kept for Clerk only.
    - The six names for a rate-limit result become one.
  - auth and account name the same UI area (AuthButton shows "Account"). It
    becomes account.

  One word for two meanings in one file
  - globals.css: "display" means the Chakra Petch typeface (font-display) and
    also tight letter spacing (tracking-display, used on Onest headings too).
    Chakra Petch also has a second name, --font-brand. Each gets one name,
    recorded in the vocabulary.
  - ssh/bootstrap.ts: a bare key (the SSH key pair) sits next to encryptionKey
    and hostKey, so it becomes keyPair.

  Names
  - Verb first:
    - current → getCurrent, status → getStatus, memberAccess → getMemberAccess
    - space, sameBytes, validText → is…
    - remoteError → toSshError, kebabCase → toKebabCase (to joins the prefix
      table; toUserFields already uses it)
  - Truthful public names: the public remove and power only record requests, so
    they become requestDelete and requestPower. This removes the reserved-word
    exception for servers. Internal users.remove is now the only place that
    needs the remove substitute.
  - SSH exports that don't say "SSH":
    - connectionForAllocation → getSshConnection
    - protocolRequest → sshRequest
    - inspectPublicKey → inspectSshPublicKey

  External systems
  - Clerk UI configuration translates our design tokens and copy into Clerk's
    format. Today that's the appearance and localization props in layout.tsx and
    the --clerk-* block in globals.css. They move to clerk-provider.tsx and
    clerk.css, next to convex-client-provider.tsx.
  - cloud-init: the config is rendered inside ssh/bootstrap.ts. It moves to
    ssh/cloud_init.ts, and bootstrapConfig becomes renderCloudInit.
  - The host-key report script is Python embedded inline, while the write script
    lives in write_file_script.ts. It becomes ssh/report_host_key_script.ts, so
    both follow the same pattern.
  - Hetzner config checks: reserve validates Hetzner's env settings (location
    format, controller ID, firewall ID). That moves into hetzner_cloud/.
  - Hetzner error codes currently share our error field. The Hetzner code stays
    exactly as Hetzner writes it, in the Hetzner part of the allocation, and
    error holds only our codes.
  - Workpool component names workpool and serverCleanup only pace Hetzner calls.
    They become hetznerCloudWork and hetznerCloudCleanup (matching the
    rate-limit keys) and are defined once.
  - docs/setups/hetzner.md becomes hetzner-cloud.md.

  Structure
  - src/components/:
    - account/ gets control.tsx, button.tsx and clerk-provider.tsx.
    - layout/ gets header.tsx and footer.tsx.
    - legal-page.tsx and convex-client-provider.tsx stay as single files.
  - Tables:
    - users, disabledUsers
    - servers, serverNames, serverMemberships
    - serverGrants, serverAllocations, serverOperations
    - hetznerCloudScans, hetznerCloudFindings
    - allocationSshAccess

  Handling every kind
  - The power command is a nested ternary over start / stop / forceStop.
  - pathFor and singular are two-way ternaries over three resource kinds.
  - The scan kind flips back and forth with a ternary.
  - Allocation status is checked with .includes(...) on a list.
  - AuthorizedKeysEdit: a new edit kind would silently be treated as an update.

  All of these become a switch or a Record.

  Characters
  - One authored hit in AGENTS.md (doesn’t), plus an ignore range around the
    Next.js block.
  - Two in authored docs.
  - 42 in the two *-prompts.md docs.

  Existing rules broken
  - fix needs --sequential once there are two fixers.
  - Failures are only logged, not shown. Two UI failures only reach the console,
    but AGENTS.md calls for floating UI messages for transient outcomes. That
    needs the primitive; step 3.

  Already consistent, no change:
  - Every env variable in use is in an example file or built in.
  - HTTP paths are symmetric (/webhooks/clerk, /bootstrap/ssh).
  - Index names, brand/ and ui/, and the Convex entry files are fine.
  - Hetzner label keys and machine-side file names follow their systems'
    conventions.

  Your decisions

  1. Schema. Two rules now conflict. "Every validator in schema.ts" collides
     with "Hetzner words stay in the Hetzner folder", because the allocation
     table holds Hetzner fields (firewallId, serverType, resources, action). I
     recommend: schema.ts still declares every table, but Hetzner fields sit
     under a backend object whose validator is exported from
     allocations/hetzner_cloud/. A later backend then adds one union member.
     This revises the earlier schema decision.
  2. The two *-prompts.md docs: fix their characters in step 1, or delete them
     now if they've served their purpose?

✻ Brewed for 8m 11s · done 2:41 PM

❯ For the prompts, I am not sure if they have served their purpose, so I think  
  we should just keep them fixed them for now. As for the first decision, so    
  the schema or the backend stuff, I would like you to make a proper impartial  
  judgment without thinking about existing data or migrating things or          
  backwards compatibility. Just think about it from first principles and land   
  on the cleanest, symmetric, good shape that, like, aligns with our things,    
  without rules, without becoming, like, this one-off exception that I keep     
  sort of mentioning. Or perhaps it would carve out a rule of its own to not be 
  the sort of magic exception, I guess. Other than that, I mean, I think we     
  can literally implement everything all at once, no need for, like, steps and  
  stuff unless you think further decisions or forks are needed from me. And     
  yeah, I mean, let's let me know when you're ready.                            

● Schema: decision from first principles

  Setting data and migration aside, there are three ways to hold Hetzner's
  allocation data:

  Shape: All validators in root schema.ts
  Problem: Hetzner's words sit in a shared file, which breaks the
  external-system
  rule.
  ────────────────────────────────────────
  Shape: A backend object inside serverAllocations, with its validator imported
  from hetzner_cloud/
  Problem: One table mixes our fields with Hetzner's. The table belongs to
  allocations/ while half its fields belong to hetzner_cloud/, and the sweep
  index has to reach into the nested object. That's the special case you were
  sensing.
  ────────────────────────────────────────
  Shape: A separate table per backend: hetznerCloudAllocations (one row per
  allocation, holding its Hetzner Cloud state)
  Problem: No special form. Recommended.

  Why the third shape is the clean one:
  - Every table belongs wholly to one folder and uses one vocabulary.
    serverAllocations keeps only fields that backend-independent code reads:
    serverId, grantId, operationId, status, deleteRequested, error, observedAt,
    addresses, and backend: "hetznerCloud". Everything else moves to
    hetznerCloudAllocations, with its own indexes: resources, spec, firewall,
    controller, action, the Hetzner error code, and the worker's dueAt /
    leaseExpiresAt / epoch / failures.
  - Convex's own guidelines recommend it. They say to move frequently changing
    operational data into its own table. The worker's lease fields change every
    few seconds. Today every lease tick rewrites the allocation row, which
    reruns every status query subscribed to it. After the split, those
    subscriptions only rerun when something users can see changes.
  - The repo already does this. allocationSshAccess is exactly this kind of
    per-allocation table.
  - Two backends side by side stay clean. A later backend adds its own folder
    and tables (including hosts, if it has them) and one more backend value. It
    never changes a Hetzner table.
  - Atomicity is kept. Both rows are written in the same mutation.

  Where tables are defined. The same reasoning gives a general rule. Each folder
  defines the tables its code owns in its own schema.ts, and includes the
  tables of its direct subfolders. The root convex/schema.ts is just the top of
  that tree. This is the same fan-out-to-direct-children principle your script
  rule already uses. ai-town uses per-folder schema files like this in
  production.

  convex/schema.ts                          users · disabledUsers          +
  servers, allocations, ssh
  convex/servers/schema.ts                  servers · serverNames ·
  serverMemberships
  convex/allocations/schema.ts              serverGrants · serverAllocations ·
  serverOperations   + hetzner_cloud
  convex/allocations/hetzner_cloud/schema.ts   hetznerCloudAllocations ·
  hetznerCloudScans · hetznerCloudFindings
  convex/ssh/schema.ts                      allocationSshAccess

  Rule text, added to the structure bullet:

  ▎ "A folder defines the tables that its code owns in its own schema.ts, and 
  ▎ includes the tables of its immediate subfolders. The root convex/schema.ts 
  ▎ defines the tables of top-level files and includes the rest."

  This replaces the earlier "one root schema.ts holds every table" decision.
  Hetzner's server resource kind and its labels stay exactly as Hetzner writes
  them, inside hetzner_cloud/.

  Implementing it all in one pass

  Everything agreed so far goes in together:
  - Rules and tooling: the AGENTS.md text, docs/vocabulary.md, the strict Biome
    settings, and scripts/characters.ts.
  - Layout: the moves and renames, including the per-folder schema files above.
  - Code-quality fixes: everything from the full pass.
  - Violations found along the way:
    - the power rate-limit rollback bug
    - a floating UI message for the two failures that only log to the console,
      using @base-ui/react, which is already a dependency
  - Characters: the prompt docs are kept and fixed.
  - Docs: decisions.md and the setup docs are updated to match.

  Last comes a full verification: bun run verify, a Convex dev push, and the 58
  SSH tests. Then one commit in the usual style.

  The pending firewall and SSH-reachability work from the Codex thread stays out
  of scope, to continue afterwards.

  One confirmation before I start. The renamed tables and moved function paths
  need the dev deployment cleared. That means:
  - the existing documents
  - queued scheduled jobs and Workpool items that point at old paths
  - the rate-limit state

  What you'd lose: synced users come back from Clerk on the next sign-in or
  hourly sync. Any server grant you set for testing has to be set again with
  allocations/grants:set. I'll check that no Hetzner resources are still labeled
  with this controller before clearing, so nothing is left running.

  Once you confirm, I'll start.

✻ Cooked for 2m 13s · done 2:55 PM