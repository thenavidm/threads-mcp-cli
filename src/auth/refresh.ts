/**
 * `threads-cli refresh`: extend every stored token now.
 *
 * The server refreshes a token on its own once it is within the refresh window,
 * but only one it keeps in the store, and only while it runs. This is for the
 * token that is about to lapse on a machine where nothing has run lately.
 */

import { EXIT } from "@thenavidm/slipway";
import { ThreadsClient } from "../api/client.js";
import { loadConfig } from "../config.js";
import { accountsFromStore } from "./store.js";
import { daysRemaining } from "./tokens.js";

export async function runRefresh(out: (line: string) => void): Promise<number> {
  const stored = accountsFromStore(loadConfig().storePath);
  const config = loadConfig(stored);

  if (!config.accounts.length) {
    out("No Threads profile is connected. Run `threads-cli login`.");
    return EXIT.notConfigured;
  }

  const client = new ThreadsClient(config);
  let failed = false;

  for (const account of config.accounts) {
    const label = account.username ? `@${account.username}` : (account.userId ?? "unresolved");
    if (account.source !== "store") {
      out(`  - ${label}: the token came from the environment, so a refreshed value cannot be saved anywhere.`);
      continue;
    }
    const before = daysRemaining(account);
    if (await client.refresh(account)) {
      out(`  ✓ ${label}: ${before ?? "?"} → ${daysRemaining(account) ?? "?"} days`);
    } else {
      failed = true;
      out(`  ✗ ${label}: refresh refused. A token must be at least 24 hours old and not yet expired. Run \`threads-cli login\`.`);
    }
  }

  return failed ? EXIT.auth : EXIT.ok;
}
