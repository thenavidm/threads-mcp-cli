/**
 * `threads-cli doctor`: find out what is actually wrong.
 *
 * Threads fails in ways that look identical from a tool call. A missing scope
 * usually returns an empty result rather than an error. An expired token and a
 * token that was never long-lived both read as "rejected". A profile with 99
 * followers gets nothing back from demographics and no explanation.
 *
 * So this probes each capability separately with the cheapest call that proves
 * it, and reports what is granted, what is missing, and what to do about each.
 * Slipway runs it on every `doctor`, as 1.1 did, because none of it shows up
 * without a request.
 */

import type { DoctorCheck } from "@thenavidm/slipway";
import type { ThreadsClient } from "./api/client.js";
import { ThreadsError } from "./api/errors.js";
import { accountsFromStore } from "./auth/store.js";
import { daysRemaining } from "./auth/tokens.js";
import type { Account, Config } from "./config.js";
import type { ToolContext } from "./tools/kit.js";

/**
 * Probe one capability.
 *
 * A permission failure is reported as a warning rather than an error: an app
 * that never asked for keyword search is not broken, it just cannot search.
 */
async function probe(name: string, fix: string, run: () => Promise<string>): Promise<DoctorCheck> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (error) {
    if (error instanceof ThreadsError && error.name === "PermissionError") {
      return { name, ok: false, warn: true, detail: "not granted", fix };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { name, ok: false, detail: message.slice(0, 160), fix };
  }
}

async function checkAccount(client: ThreadsClient, account: Account): Promise<DoctorCheck[]> {
  const label = account.username ? `@${account.username}` : (account.userId ?? "unresolved");
  const checks: DoctorCheck[] = [];

  let userId: string;
  let geo: boolean | undefined;
  try {
    const profile = await client.profile(account);
    userId = profile.id;
    geo = profile.is_eligible_for_geo_gating;
    checks.push({
      name: `${label} token`,
      ok: true,
      detail: `valid, acting as @${profile.username ?? profile.id}${profile.is_verified ? ", verified" : ""}, credential from ${account.source}`,
    });
  } catch (error) {
    checks.push({
      name: `${label} token`,
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
      fix: "Run `threads-cli login` to authorize again. An expired Threads token cannot be refreshed, only replaced.",
    });
    return checks;
  }

  const days = daysRemaining(account);
  if (days === undefined) {
    checks.push({
      name: `${label} expiry`,
      ok: true,
      warn: true,
      detail: "unknown: this token came from the environment, so its expiry was never recorded. `threads-cli login` lets the server own the token and refresh it before it lapses.",
    });
  } else if (days <= 7) {
    checks.push({ name: `${label} expiry`, ok: false, detail: `${days} days left`, fix: "Run `threads-cli refresh` now. A token that lapses cannot be recovered." });
  } else {
    checks.push({ name: `${label} expiry`, ok: true, detail: `${days} days left` });
  }

  const probes = await Promise.all([
    probe(`${label} read own posts`, "threads_basic is missing, which is unusual. Authorize again.", async () => {
      const response = (await client.call(account, `/${userId}/threads`, { params: { fields: "id", limit: 1 } })) as { data?: unknown[] };
      return `${response.data?.length ?? 0} post(s) readable`;
    }),

    probe(`${label} publishing quota`, "Add threads_content_publish and authorize again.", async () => {
      const response = (await client.call(account, `/${userId}/threads_publishing_limit`, {
        params: { fields: "quota_usage,reply_quota_usage" },
      })) as { data?: Array<{ quota_usage?: number; reply_quota_usage?: number }> };
      const row = response.data?.[0] ?? {};
      return `${row.quota_usage ?? 0}/250 posts and ${row.reply_quota_usage ?? 0}/1000 replies used today`;
    }),

    probe(`${label} replies`, "Add threads_read_replies and authorize again.", async () => {
      const response = (await client.call(account, `/${userId}/replies`, { params: { fields: "id", limit: 1 } })) as { data?: unknown[] };
      return `readable (${response.data?.length ?? 0} recent)`;
    }),

    probe(`${label} insights`, "Add threads_manage_insights and authorize again.", async () => {
      const response = (await client.call(account, `/${userId}/threads_insights`, {
        params: { metric: "followers_count" },
      })) as { data?: Array<{ total_value?: { value?: number } }> };
      const followers = response.data?.[0]?.total_value?.value;
      return followers === undefined ? "readable" : `${followers} followers`;
    }),

    probe(
      `${label} keyword search`,
      "Needs threads_keyword_search, which requires App Review. Without it, searches quietly return only your own posts.",
      async () => {
        const response = (await client.call(account, "/keyword_search", {
          params: { q: "threads", search_type: "TOP", fields: "id,username", limit: 2 },
        })) as { data?: Array<{ username?: string }> };
        const rows = response.data ?? [];
        const mine = account.username;
        const onlyMine = rows.length > 0 && rows.every((r) => r.username?.toLowerCase() === mine);
        return onlyMine ? "granted, but every result was your own, so likely unapproved" : `${rows.length} result(s)`;
      },
    ),

    probe(
      `${label} profile discovery`,
      "Needs threads_profile_discovery and expanded access. Without it, only Meta's own accounts resolve.",
      async () => {
        const response = (await client.call(account, "/profile_lookup", {
          params: { username: "threads", fields: "id,username" },
        })) as { username?: string };
        return response.username ? `resolved @${response.username}` : "reachable";
      },
    ),
  ]);
  checks.push(...probes);

  // Meta switches geo-gating on per profile, and nothing can request it, so a profile without it is not broken.
  checks.push(
    geo === true
      ? { name: `${label} geo-gating`, ok: true, detail: "eligible" }
      : { name: `${label} geo-gating`, ok: false, warn: true, detail: "not enabled for this profile. Meta enables it per profile; there is no way to request it through the API." },
  );
  return checks;
}

export async function doctor(ctx: ToolContext, options: { network: boolean }): Promise<DoctorCheck[]> {
  const { client, config } = ctx;
  const appSet = Boolean(config.appId && config.appSecret);
  const checks: DoctorCheck[] = [
    appSet
      ? { name: "App credentials", ok: true, detail: "THREADS_APP_ID and THREADS_APP_SECRET are set" }
      : { name: "App credentials", ok: false, warn: true, detail: "not set. Only `threads-cli login` needs them; refreshing a token does not." },
    { name: "Token store", ok: true, detail: `${accountsFromStore(config.storePath).length} token(s) at ${config.storePath}` },
  ];
  if (!options.network) return checks;

  // Network first. Every check below is meaningless if this fails, and the
  // errors it produces would all blame the token instead.
  try {
    const res = await fetch(`${config.graphHost}/v1.0/me`, { method: "GET" });
    checks.push({ name: "Network", ok: true, detail: `${config.graphHost} reachable (HTTP ${res.status} without a token, as expected)` });
  } catch (error) {
    checks.push({
      name: "Network",
      ok: false,
      detail: `cannot reach ${config.graphHost}: ${(error as Error).message}`,
      fix: "Check the connection, a proxy, or THREADS_GRAPH_HOST.",
    });
    return checks;
  }

  for (const account of config.accounts) checks.push(...(await checkAccount(client, account)));
  return checks;
}

/** Tokens that lapse within a week, for the warning a running server prints. */
export function expiringSoon(config: Config): Account[] {
  return config.accounts.filter((account) => {
    const days = daysRemaining(account);
    return days !== undefined && days <= 7;
  });
}
