/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as authorization from "../authorization.js";
import type * as billing_polar from "../billing/polar.js";
import type * as billing_reconciliation from "../billing/reconciliation.js";
import type * as billing_webhooks from "../billing/webhooks.js";
import type * as boxes_boxEvents from "../boxes/boxEvents.js";
import type * as boxes_boxLogs from "../boxes/boxLogs.js";
import type * as boxes_boxMetrics from "../boxes/boxMetrics.js";
import type * as boxes_boxMetricsPoll from "../boxes/boxMetricsPoll.js";
import type * as boxes_boxOperationRules from "../boxes/boxOperationRules.js";
import type * as boxes_boxOperations from "../boxes/boxOperations.js";
import type * as boxes_boxPassword from "../boxes/boxPassword.js";
import type * as boxes_boxQueries from "../boxes/boxQueries.js";
import type * as boxes_boxSnapshots from "../boxes/boxSnapshots.js";
import type * as boxes_boxStatus from "../boxes/boxStatus.js";
import type * as boxes_boxViews from "../boxes/boxViews.js";
import type * as boxes_infra_cloudflareDns from "../boxes/infra/cloudflareDns.js";
import type * as boxes_infra_hetznerVps from "../boxes/infra/hetznerVps.js";
import type * as boxes_infra_runtimeArtifacts from "../boxes/infra/runtimeArtifacts.js";
import type * as boxes_infra_runtimeImages from "../boxes/infra/runtimeImages.js";
import type * as boxes_infra_ssh from "../boxes/infra/ssh.js";
import type * as boxes_infra_sshKeys from "../boxes/infra/sshKeys.js";
import type * as boxes_metricThresholds from "../boxes/metricThresholds.js";
import type * as boxes_reconcile from "../boxes/reconcile.js";
import type * as boxes_slugAvailability from "../boxes/slugAvailability.js";
import type * as boxes_snapshotPolicy from "../boxes/snapshotPolicy.js";
import type * as boxes_workflows_boxWorkflow from "../boxes/workflows/boxWorkflow.js";
import type * as boxes_workflows_changeBoxPassword from "../boxes/workflows/changeBoxPassword.js";
import type * as boxes_workflows_changeBoxSlug from "../boxes/workflows/changeBoxSlug.js";
import type * as boxes_workflows_deleteBox from "../boxes/workflows/deleteBox.js";
import type * as boxes_workflows_provisionBox from "../boxes/workflows/provisionBox.js";
import type * as boxes_workflows_resetBox from "../boxes/workflows/resetBox.js";
import type * as boxes_workflows_runtimeLifecycle from "../boxes/workflows/runtimeLifecycle.js";
import type * as boxes_workflows_snapshotWorkflows from "../boxes/workflows/snapshotWorkflows.js";
import type * as boxes_workflows_startBox from "../boxes/workflows/startBox.js";
import type * as boxes_workflows_stopBox from "../boxes/workflows/stopBox.js";
import type * as boxes_workflows_suspendBox from "../boxes/workflows/suspendBox.js";
import type * as boxes_workflows_unsuspendBox from "../boxes/workflows/unsuspendBox.js";
import type * as checkout_checkoutConversion from "../checkout/checkoutConversion.js";
import type * as checkout_checkoutIntents from "../checkout/checkoutIntents.js";
import type * as crons from "../crons.js";
import type * as env from "../env.js";
import type * as http from "../http.js";
import type * as settings from "../settings.js";
import type * as staff_boxes from "../staff/boxes.js";
import type * as staff_checkout from "../staff/checkout.js";
import type * as staff_metrics from "../staff/metrics.js";
import type * as staff_settings from "../staff/settings.js";
import type * as staff_stats from "../staff/stats.js";
import type * as staff_users from "../staff/users.js";
import type * as user_boxes from "../user/boxes.js";
import type * as user_checkout from "../user/checkout.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  authorization: typeof authorization;
  "billing/polar": typeof billing_polar;
  "billing/reconciliation": typeof billing_reconciliation;
  "billing/webhooks": typeof billing_webhooks;
  "boxes/boxEvents": typeof boxes_boxEvents;
  "boxes/boxLogs": typeof boxes_boxLogs;
  "boxes/boxMetrics": typeof boxes_boxMetrics;
  "boxes/boxMetricsPoll": typeof boxes_boxMetricsPoll;
  "boxes/boxOperationRules": typeof boxes_boxOperationRules;
  "boxes/boxOperations": typeof boxes_boxOperations;
  "boxes/boxPassword": typeof boxes_boxPassword;
  "boxes/boxQueries": typeof boxes_boxQueries;
  "boxes/boxSnapshots": typeof boxes_boxSnapshots;
  "boxes/boxStatus": typeof boxes_boxStatus;
  "boxes/boxViews": typeof boxes_boxViews;
  "boxes/infra/cloudflareDns": typeof boxes_infra_cloudflareDns;
  "boxes/infra/hetznerVps": typeof boxes_infra_hetznerVps;
  "boxes/infra/runtimeArtifacts": typeof boxes_infra_runtimeArtifacts;
  "boxes/infra/runtimeImages": typeof boxes_infra_runtimeImages;
  "boxes/infra/ssh": typeof boxes_infra_ssh;
  "boxes/infra/sshKeys": typeof boxes_infra_sshKeys;
  "boxes/metricThresholds": typeof boxes_metricThresholds;
  "boxes/reconcile": typeof boxes_reconcile;
  "boxes/slugAvailability": typeof boxes_slugAvailability;
  "boxes/snapshotPolicy": typeof boxes_snapshotPolicy;
  "boxes/workflows/boxWorkflow": typeof boxes_workflows_boxWorkflow;
  "boxes/workflows/changeBoxPassword": typeof boxes_workflows_changeBoxPassword;
  "boxes/workflows/changeBoxSlug": typeof boxes_workflows_changeBoxSlug;
  "boxes/workflows/deleteBox": typeof boxes_workflows_deleteBox;
  "boxes/workflows/provisionBox": typeof boxes_workflows_provisionBox;
  "boxes/workflows/resetBox": typeof boxes_workflows_resetBox;
  "boxes/workflows/runtimeLifecycle": typeof boxes_workflows_runtimeLifecycle;
  "boxes/workflows/snapshotWorkflows": typeof boxes_workflows_snapshotWorkflows;
  "boxes/workflows/startBox": typeof boxes_workflows_startBox;
  "boxes/workflows/stopBox": typeof boxes_workflows_stopBox;
  "boxes/workflows/suspendBox": typeof boxes_workflows_suspendBox;
  "boxes/workflows/unsuspendBox": typeof boxes_workflows_unsuspendBox;
  "checkout/checkoutConversion": typeof checkout_checkoutConversion;
  "checkout/checkoutIntents": typeof checkout_checkoutIntents;
  crons: typeof crons;
  env: typeof env;
  http: typeof http;
  settings: typeof settings;
  "staff/boxes": typeof staff_boxes;
  "staff/checkout": typeof staff_checkout;
  "staff/metrics": typeof staff_metrics;
  "staff/settings": typeof staff_settings;
  "staff/stats": typeof staff_stats;
  "staff/users": typeof staff_users;
  "user/boxes": typeof user_boxes;
  "user/checkout": typeof user_checkout;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  polar: import("@convex-dev/polar/_generated/component.js").ComponentApi<"polar">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
