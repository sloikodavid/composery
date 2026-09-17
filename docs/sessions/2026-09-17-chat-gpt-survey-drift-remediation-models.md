# Survey Drift Remediation Models

Source: https://chatgpt.com/share/6aac0b64-4278-83eb-ae99-12e13828d886

---

## Turn 1: User

_2026-09-17T13:59:19.861Z_

As of September 2026, survey how infrastructure controllers treat a security control that someone other than the controller removed out of band, such as a firewall or security group detached from a server in the provider's console: Crossplane, Kubernetes cloud controllers, CAPH, Terraform drift detection, AWS Config remediation, and Azure Policy. For each: whether the controller restores the control automatically, reports it only, or blocks other operations until it is restored; how it tells an intended change from an accidental one; and documented incidents in either direction, where automatic restoration fought an operator or where reporting alone left a system exposed.

---

## Turn 2: ChatGPT

_2026-09-17T13:59:24.651Z_

I’ll treat “CAPH” as Cluster API Provider Hetzner unless the evidence points elsewhere. I’m going to compare reconciliation semantics, intent signals, and real-world failure modes, prioritizing official docs and issue reports over blog summaries.

---

## Turn 3: ChatGPT

_2026-09-17T14:00:02.313Z_

The first important split is emerging: these systems do **not** all mean the same thing by “drift.” Crossplane treats provider state as continuously reconcilable desired state by default; HCP Terraform’s drift service is deliberately non-actionable; Kubernetes cloud controllers vary by the specific external resource and often warn not to rely on reconciliation as a security mechanism.

---

## Turn 4: ChatGPT

_2026-09-17T14:02:45.292Z_

Azure Policy is the clearest “prevent rather than repair” case—but only when the policy uses a **deny**-class effect that can see the offending ARM request. Its common NSG baseline (“Subnets should be associated with a Network Security Group”) is instead `AuditIfNotExists`, so a detached NSG is normally reported, not reattached.

---

## Turn 5: ChatGPT

_2026-09-17T14:06:06.629Z_

As of **17 September 2026**, the six systems fall into three quite different models: **continuous desired-state reconcilers** such as Crossplane; **drift/compliance detectors with optional remediation** such as Terraform/HCP and AWS Config; and **request-time policy enforcement** such as Azure Policy. Kubernetes cloud controllers and CAPH sit between these models because ownership is resource- and provider-specific.

| System | If somebody removes a security control out of band | How “intent” is determined | Does noncompliance block other work? | Documented failure mode |
|---|---|---|---|---|
| **Crossplane** | **Normally restores it automatically** if the relevant property/resource is under full management. Crossplane explicitly describes detecting console/CLI drift and enforcing declared state without user interaction. ([Crossplane Documentation](https://docs.crossplane.io/latest/guides/change-logs/?utm_source=chatgpt.com)) | It does **not infer whether the human meant it**. The managed-resource spec is authoritative. `managementPolicies` can cede update/delete responsibility or make a resource observe-only; pausing reconciliation is another deliberate escape hatch. | **No general block.** It converges asynchronously; individual resources can become unready or an update can fail. | Provider AWS issue #929 repeatedly detached and reattached IAM policies on every reconciliation, leaving permissions wrong for up to ~30 seconds and causing application errors/downtime. ([GitHub](https://github.com/crossplane-contrib/provider-upjet-aws/issues/929?utm_source=chatgpt.com)) |
| **Kubernetes cloud controllers** | **Controller-specific.** For a controller-owned cloud object it may restore drift. AWS Load Balancer Controller, for example, assumes ownership of WAF associations unless disabled; however its full periodic sync defaults to **10 hours**, and its own docs say not to depend on reconciliation to undo manual security changes. ([Kubernetes SIGs](https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.12/deploy/configurations/?utm_source=chatgpt.com)) | Kubernetes desired state plus controller annotations/flags decide ownership. For AWS LBC, supplying custom SGs and `manage-backend-security-group-rules` controls which SG rules it manages. ([GitHub](https://github.com/kubernetes-sigs/aws-load-balancer-controller/blob/main/docs/deploy/security_groups.md?utm_source=chatgpt.com)) | **No general block.** Cloud reconciliation is asynchronous. | AWS LBC issue #4652, opened March 2026, reports the controller trying to authorize SG ingress even with `manage-backend-security-group-rules=false`—a concrete case of reconciliation crossing an operator-declared ownership boundary. ([GitHub](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/4652?utm_source=chatgpt.com)) |
| **CAPH** (Cluster API Provider Hetzner) | **Only for infrastructure CAPH actually models.** CAPH advertises declarative/self-healing reconciliation. But for the specific example of a Hetzner Cloud firewall being detached from a server, I found **no firewall resource or firewall-attachment field in CAPH's current documented CRD/reference surface**; consequently CAPH has no declared firewall state to restore or even flag. ([GitHub](https://github.com/syself/cluster-api-provider-hetzner?utm_source=chatgpt.com)) | Its CAPI/CAPH objects are desired state. A namespace can explicitly be excluded from CAPH reconciliation; recent features also use explicit readiness annotations when an automatic transition would otherwise be unsafe. ([New Releases](https://newreleases.io/project/github/syself/cluster-api-provider-hetzner/release/v1.1.0?utm_source=chatgpt.com)) | **No general security gate.** It can wait on conditions in particular lifecycle operations, but an unmodelled firewall loss does not freeze the cluster. | I found no public CAPH incident specifically involving a detached Hetzner firewall. Its release history does show analogous reconciliation gaps around controller-managed load-balancer state; this is mainly an availability rather than firewall-security example. Current latest release is v1.1.8, released 3 Aug 2026. ([GitHub](https://github.com/syself/cluster-api-provider-hetzner/releases?utm_source=chatgpt.com)) |
| **Terraform / HCP Terraform drift detection** | **HCP drift detection reports only.** Health assessments are non-actionable refresh-only plans and run roughly every 24 hours. A subsequent normal Terraform plan/apply generally proposes/restores configuration drift. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/tutorials/cloud/drift-detection?utm_source=chatgpt.com)) | Terraform likewise doesn't infer the operator's motive. HCL is authoritative unless the operator changes HCL to adopt the new state or declares external ownership using `ignore_changes`. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle?utm_source=chatgpt.com)) | **Normally no.** Drift reporting does not stop operations. A provider read/reconciliation bug can, however, make plan/apply fail. | Two strong 2026 counterexamples: AWS provider issue #47440 reports normal `terraform plan` saying “No changes” after Network Firewall rules were removed out of band, although `-refresh-only` saw the drift; issue #46116 had an out-of-band SG deletion trigger a provider error that **blocked all Terraform operations** rather than cleanly recreating it. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/issues/47440?utm_source=chatgpt.com)) |
| **AWS Config** | **Reports by default; restores only if automatic remediation is configured.** Config rules can have manual or automatic SSM Automation remediation. ([AWS Documentation](https://docs.aws.amazon.com/config/latest/developerguide/setup-autoremediation.html?utm_source=chatgpt.com)) | It doesn't distinguish console changes by actor or intent. The rule's compliance condition is truth; deliberate exceptions are expressed through rule scope/parameters, manual remediation, or a `RemediationException`. ([AWS Documentation](https://docs.aws.amazon.com/config/latest/APIReference/API_PutRemediationExceptions.html?utm_source=chatgpt.com)) | **No.** It is detect-and-act, not a transaction-time guard. After repeated remediation failures it can instead create an exception and stop trying. ([AWS Documentation](https://docs.aws.amazon.com/config/latest/APIReference/API_RemediationConfiguration.html?utm_source=chatgpt.com)) | AWS itself documents the “fought the operator” hazard: auto-remediation works from periodic compliance snapshots, so a resource already fixed or intentionally changed after the snapshot can still be remediated based on stale noncompliant state. ([AWS Documentation](https://docs.aws.amazon.com/config/latest/developerguide/setup-autoremediation.html?utm_source=chatgpt.com)) |
| **Azure Policy** | **Effect-dependent.** `Audit`/`AuditIfNotExists`: report only. `Modify`: change applicable create/update requests, while existing drift needs a remediation task. `DeployIfNotExists`: existing noncompliance is detected but requires remediation. `Deny`: reject a violating create/update before the provider. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-audit-if-not-exists?utm_source=chatgpt.com)) | Again, actor identity is not the intent signal. Policy definition, assignment scope, `notScopes`, selectors and formal exemptions express intentional exceptions. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-applicability?utm_source=chatgpt.com)) | **Sometimes, prospectively.** A `Deny` policy returns 403 for the violating create/update. Existing noncompliance is merely marked noncompliant; it doesn't globally freeze the resource until repaired. ([Microsoft Learn](https://learn.microsoft.com/en-ie/azure/governance/policy/concepts/effect-deny?utm_source=chatgpt.com)) | Azure issue #1061 documents remediation replacing existing user-assigned managed identities when the operator expected a system identity merely to be added. In the other direction, historical issue #305 documents an NSG deny policy bypassed through Marketplace/ARM deployment, resulting in an NSG rule directly contrary to policy. ([GitHub](https://github.com/Azure/azure-policy/issues/1061?utm_source=chatgpt.com)) |

### Crossplane: “the spec wins”

Crossplane is the strongest example here of **continuous restoration**. Its current documentation explicitly uses the exact scenario in the question: somebody edits a provider resource outside Crossplane using the AWS console or `gcloud`; the provider observes the difference and “corrects the unexpected change without any user interaction.” ([Crossplane Documentation](https://docs.crossplane.io/latest/guides/change-logs/?utm_source=chatgpt.com))

There is no semantic distinction between an attacker, a tired operator, a cloud-provider automation and an approved emergency engineer. They all appear as “external state differs from declared state.” Intent therefore has to be expressed **before or alongside the external change** by changing Crossplane's desired state or management relationship. That is an important property of virtually every level-triggered reconciler: provenance of the write is much less important than whether the new value agrees with the source of truth.

The #929 IAM incident shows the downside particularly well. This wasn't even legitimate out-of-band drift: a provider bug made reconciliation itself repeatedly detach and reattach policy attachments, creating a period where applications lacked expected IAM permissions. ([GitHub](https://github.com/crossplane-contrib/provider-upjet-aws/issues/929?utm_source=chatgpt.com)) Automatic repair therefore limits the duration of accidental drift, but also gives controller mistakes considerable authority.

### Kubernetes cloud controllers: no single drift contract

“Kubernetes cloud controller” should not be treated as one product-level guarantee. The upstream cloud-controller-manager defines broad responsibilities—its Service controller can manage cloud load balancers, IP addresses, packet filtering and health checks—but implementation is left to each cloud provider. ([Kubernetes](https://kubernetes.io/docs/concepts/architecture/cloud-controller/?utm_source=chatgpt.com))

AWS Load Balancer Controller illustrates the ambiguity nicely. Some things are emphatically controller-owned: with its WAF integrations enabled, it assumes sole ownership, so a third-party WAF association/removal can be reverted. But its documented full reconciliation period is **10 hours**, and the maintainers explicitly warn users **not to use that reconciliation as mitigation for security risk**. ([Kubernetes SIGs](https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.12/deploy/configurations/?utm_source=chatgpt.com))

That makes it “automatic eventually,” not “a security control that is continuously guaranteed.” An event involving the Kubernetes object may cause an earlier reconciliation, but an isolated provider-console edit can otherwise persist until observation catches it.

Its ownership knobs are more granular than Crossplane's generic management policies: custom security-group annotations and the backend-rule-management annotation determine whether LBC should touch particular SG rules. ([GitHub](https://github.com/kubernetes-sigs/aws-load-balancer-controller/blob/main/docs/deploy/security_groups.md?utm_source=chatgpt.com)) Issue #4652 is therefore revealing: the reporter explicitly opted out, yet the reconciler still attempted `AuthorizeSecurityGroupIngress`. ([GitHub](https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/4652?utm_source=chatgpt.com))

### CAPH: self-healing stops at its API boundary

CAPH describes itself as fully declarative and self-healing: CAPH/CAPI controllers react to infrastructure changes and resolve them. ([GitHub](https://github.com/syself/cluster-api-provider-hetzner?utm_source=chatgpt.com)) But that statement applies to **its object model**, not every object in the Hetzner project.

The current CAPH reference lists `HetznerCluster`, HCloud machine templates, bare-metal hosts/templates/remediation and annotations; I found no documented CAPH abstraction for an HCloud firewall or a server↔firewall attachment. ([GitHub](https://github.com/syself/cluster-api-provider-hetzner/blob/main/docs/README.md?utm_source=chatgpt.com)) So if an engineer goes into the Hetzner console and removes a firewall from an otherwise CAPH-managed server, **CAPH itself has nothing to compare that attachment against**. From CAPH's perspective there is no drift.

This is a useful counterexample to the broad claim that “declarative infrastructure is self-healing”: the invariant is only as strong as the controller's ownership graph. If the firewall is instead owned by Terraform, another Kubernetes operator, or some policy system, *that* controller may restore it.

CAPH does have deliberate escape and transition mechanisms. Its skip-namespace annotation suppresses all CAPH reconciliation in that namespace. ([New Releases](https://newreleases.io/project/github/syself/cluster-api-provider-hetzner/release/v1.1.0?utm_source=chatgpt.com)) A 2026 control-plane load-balancer change is more sophisticated: enabling proxy protocol on an existing cluster requires both the desired spec value and a readiness annotation on **every** control-plane node, because blindly reconciling it could break nodes that aren't ready for PROXY headers. ([GitHub](https://github.com/syself/cluster-api-provider-hetzner/issues/2112?utm_source=chatgpt.com)) That's a good example of a controller using an explicit “intent + readiness” handshake rather than trying to infer whether external reality is accidental.

### Terraform: detection and convergence are separate operations

Terraform is often grouped with reconcilers, but **HCP Terraform drift detection is intentionally not one**. Health assessments execute non-actionable refresh-only plans approximately once every 24 hours; they update neither infrastructure nor Terraform state. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/tutorials/cloud/drift-detection?utm_source=chatgpt.com))

A normal Terraform run changes the picture. By default, when Terraform sees a remote property differ from configuration, it plans to put the remote object back into the configured state. If another system is meant to own that property, `ignore_changes` is the formal declaration of that split ownership. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle?utm_source=chatgpt.com)) Thus:

**console detach → health assessment** = report;  
**console detach → ordinary plan/apply** = normally propose and, after apply, restore.

The security difference can be material. HashiCorp's own drift tutorial deliberately changes an AWS bastion security group to admit `0.0.0.0/0`: HCP detects it but doesn't automatically close it. ([HashiCorp Developer](https://developer.hashicorp.com/terraform/tutorials/cloud/drift-detection?utm_source=chatgpt.com)) That is a tutorial rather than a production incident, but it demonstrates the designed exposure window.

There are also real detection failures. In AWS provider issue #47440, filed in 2026, removing rules from an AWS Network Firewall rule group through the console caused ordinary `terraform plan` to report that infrastructure matched configuration; only `plan -refresh-only` showed the difference. ([GitHub](https://github.com/hashicorp/terraform-provider-aws/issues/47440?utm_source=chatgpt.com)) Separately, a 2026 Hetzner provider bug is unusually close to your firewall example: during server replacement, the provider erroneously removed the firewall from Terraform state and **never attached the firewall to the replacement server**. ([GitHub](https://github.com/hetznercloud/terraform-provider-hcloud/issues/1379?utm_source=chatgpt.com))

Terraform can also accidentally turn drift into a hard operational stop. AWS provider issue #46116 documents deleting an SG out of band and then having the provider fail during Read with “Missing Resource Identity,” blocking all Terraform plan/apply operations. That was a provider defect, not Terraform's intended security model, but it shows a third possible behavior beyond “repair” and “report”: **the reconciler loses enough referential integrity that it cannot proceed.** ([GitHub](https://github.com/hashicorp/terraform-provider-aws/issues/46116?utm_source=chatgpt.com))

### AWS Config: remediation is an explicitly attached action

AWS Config cleanly separates the compliance rule from remediation. A rule can simply mark the resource noncompliant, or you can associate an SSM Automation remediation and choose **manual or automatic** execution. ([AWS Documentation](https://docs.aws.amazon.com/config/latest/developerguide/setup-autoremediation.html?utm_source=chatgpt.com))

The rule does not ask “was this change approved?” If the resulting resource violates the rule, it is noncompliant. An intended exception therefore has to be encoded as scope/parameters or a remediation exception. Exceptions explicitly remove the resource from auto-remediation. ([AWS Documentation](https://docs.aws.amazon.com/config/latest/APIReference/API_PutRemediationExceptions.html?utm_source=chatgpt.com))

An interesting safety valve works opposite to “block until fixed”: after a configured number of unsuccessful automatic attempts—five by default—Config creates a remediation exception so it stops looping indefinitely. ([AWS Documentation](https://docs.aws.amazon.com/config/latest/APIReference/API_RemediationConfiguration.html?utm_source=chatgpt.com))

AWS also documents a particularly important race. Auto-remediation consumes periodic compliance snapshots. If a resource was noncompliant at snapshot time and an operator fixes or intentionally changes it afterward, the stale snapshot can still cause Config to execute the remediation. AWS explicitly says this means remediation can start against a resource that is **currently compliant**. ([AWS Documentation](https://docs.aws.amazon.com/config/latest/developerguide/setup-autoremediation.html?utm_source=chatgpt.com)) That is exactly the class of “controller fights an operator” problem that event-sourced attribution might avoid, but AWS Config's compliance model does not attempt such attribution.

### Azure Policy: prevention is possible, but it is not the default for every security baseline

Azure Policy is the only item in this set whose core model can straightforwardly **reject the out-of-band operation itself**. A `Deny` effect evaluates a matching ARM create/update request before it reaches the resource provider and returns HTTP 403 if it violates policy. Existing violating resources, however, are merely marked noncompliant. ([Microsoft Learn](https://learn.microsoft.com/en-ie/azure/governance/policy/concepts/effect-deny?utm_source=chatgpt.com))

That distinction matters for the firewall example. If you can write a `Deny` policy whose aliases and evaluation semantics cover the operation that removes the protection, the removal can be prevented in the first place. But a policy that merely audits absence does nothing during the exposure.

And Microsoft's current built-in subnet control demonstrates exactly that distinction: **“Subnets should be associated with a Network Security Group” supports `AuditIfNotExists` and `Disabled`, not Deny or automatic remediation.** ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/defender-for-cloud/policy-reference?utm_source=chatgpt.com)) `AuditIfNotExists` runs after the resource provider has successfully processed the create/update and records the noncompliance; it does not reattach the NSG. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-audit-if-not-exists?utm_source=chatgpt.com))

`Modify` and `DeployIfNotExists` occupy a middle ground. `Modify` can mutate applicable incoming requests; for already-existing noncompliance it merely flags the resource until a remediation task is created. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-modify?utm_source=chatgpt.com)) `DeployIfNotExists` likewise doesn't automatically act on an existing resource merely because a periodic evaluation notices drift; remediation is required. ([Microsoft Learn](https://learn.microsoft.com/nb-no/azure/governance/policy/concepts/effect-deploy-if-not-exists?utm_source=chatgpt.com))

Azure's “intended change” mechanism is administrative rather than inferential: assignment scope, exclusions and formal policy exemptions determine whether the invariant applies. ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-applicability?utm_source=chatgpt.com))

The failure reports cover both directions. Issue #1061 shows remediation unexpectedly overwriting user-assigned VM identities while trying to add a system identity. ([GitHub](https://github.com/Azure/azure-policy/issues/1061?utm_source=chatgpt.com)) Conversely, the older 2019 #305 report describes a Marketplace/ARM deployment bypassing an NSG deny policy so that a prohibited rule was successfully deployed. That incident is historical and should not be assumed to describe current Azure evaluation behavior, but it is a documented example of an enforcement gap leaving forbidden configuration in place. ([GitHub](https://github.com/Azure/azure-policy/issues/305?utm_source=chatgpt.com))

### The common principle

None of these systems reliably answers **“did the human mean to remove the firewall?”** by looking at the identity or provenance of the external write. Their usual question is instead **“who has authority over this field?”**

Crossplane and provider-specific Kubernetes controllers generally say: *the declarative object has authority, so restore reality*. Terraform says: *configuration has authority, but only when someone runs an actionable plan/apply*. AWS Config says: *the compliance rule decides whether this is bad, and a separately configured remediation decides whether to act*. Azure Policy can move enforcement earlier still: *reject a forbidden write before it commits*. CAPH demonstrates the limiting case: *if the property is outside my API/ownership model, I don't know there is anything to restore.*

For a security invariant such as “this server must never be without firewall X,” that means **report-only drift detection is fundamentally a detection control with an exposure window**, while periodic reconciliation is a corrective control whose exposure window is the observation/reconcile latency. Only an admission/request-time mechanism capable of evaluating that exact operation can make the invariant preventative—and even then its coverage depends on the relevant API path and policy aliases.

---

If you want, I can:

- Continue with detailed AWS Config remediation examples
- Elaborate on Kubernetes cloud controllers ownership complexity
- Explain Crossplane managementPolicies and pause reconciliation use cases
