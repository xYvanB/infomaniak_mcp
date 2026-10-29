/**
 * What each tool may do, said to the client — and a mode that holds it to it.
 *
 * MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`)
 * let a client tell "list the mailboxes" from "delete the mailbox" and ask
 * for confirmation on the second. This server declared none, so every tool
 * looked the same. The classification is by the verb in the tool's name and
 * is total: a tool whose verb is not known here fails at startup rather than
 * shipping unclassified.
 *
 * `destructiveHint` follows the MCP definition: false means the tool only
 * adds. A tool that replaces what is there (update, move, rename) is
 * destructive as much as one that deletes.
 *
 * `INFOMANIAK_READ_ONLY=true` turns the hints into a rule: only read-only
 * tools are listed and callable; the raw `infomaniak_api_call`, which can do
 * anything with the token, is hidden entirely.
 *
 * Some tools need a person to say yes on every call (see `confirmationReason`):
 * they carry Claude Code's `anthropic/requiresUserInteraction` marker, which
 * makes it prompt even in auto and bypass modes, and the server asks the
 * person itself before running them (src/confirm.ts).
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface Hints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const READ = new Set(["ping", "get", "list", "search", "download"]);
const DESTROY = new Set(["delete", "remove", "empty", "reboot", "shutdown"]);
const CREATE = new Set(["create", "add", "renew", "share", "copy", "upload"]);
/** Replaces what is there: not additive, so destructive in the MCP sense. */
const OVERWRITE = new Set(["update", "move", "rename", "set"]);
/** Brings back what was there. */
const RESUME = new Set(["boot", "restore"]);

/** The verb of `infomaniak_list_mailboxes` is `list`; of `infomaniak_kchat_create_post`, `create`. */
export function verbOf(name: string): string {
  const rest = name.replace(/^infomaniak_(kchat_)?/, "");
  return rest.split("_")[0];
}

export function classify(name: string): Hints {
  if (name === "infomaniak_api_call") {
    // Any method on any endpoint: as destructive as the token allows.
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
  }
  const verb = verbOf(name);
  if (READ.has(verb)) return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  if (DESTROY.has(verb)) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: verb !== "reboot", openWorldHint: true };
  }
  if (OVERWRITE.has(verb)) return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
  if (CREATE.has(verb)) return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  if (RESUME.has(verb)) return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  throw new Error(`policy: no classification for the verb "${verb}" of tool ${name}`);
}

/** Why a destructive tool asks, by its verb. */
const DESTRUCTIVE_REASON: Record<string, string> = {
  delete: "It deletes data; the API has no undo.",
  remove: "It removes data; the API has no undo.",
  empty: "It permanently deletes everything in the trash.",
  reboot: "It restarts the server: whatever runs on it is interrupted.",
  shutdown: "It stops the server: whatever runs on it goes down.",
  update: "It replaces the current values.",
  set: "It replaces the current values.",
  move: "It moves the item: links and paths to it change.",
  rename: "It renames the item: links and paths to it change.",
};

/**
 * Tools that only add, yet must be approved: what they add reaches outside
 * the account, costs money, or runs code.
 */
const SENSITIVE: Record<string, string> = {
  infomaniak_renew_domain: "It renews the domain, which is charged to the account.",
  infomaniak_create_dns_record:
    "It publishes a DNS record: it can redirect web or mail traffic, or prove ownership of the domain to a third party.",
  infomaniak_create_cron_job: "It runs a command on the hosting on a schedule.",
  infomaniak_create_ftp_account: "It creates credentials with access to the hosting's files.",
  infomaniak_share_kdrive_file: "It makes the file reachable by anyone who has the link.",
  infomaniak_add_mailbox_forwarding: "It sends a copy of every message of the mailbox to another address.",
  infomaniak_create_email_redirection: "It sends the mail of an address to other addresses.",
  infomaniak_kchat_create_post: "It posts a message in your name.",
};

/** Destructive by their verb, yet trivially undone: they do not ask. */
const NO_QUESTION = new Set(["infomaniak_remove_kdrive_favorite"]);

/**
 * Why a person must approve every call of this tool, or null when the tool
 * runs without asking. Reads never ask; destructive tools always do (but the
 * ones in NO_QUESTION); additive tools ask when they are SENSITIVE.
 */
export function confirmationReason(name: string): string | null {
  if (name === "infomaniak_api_call") {
    return "It calls any endpoint with any method, with every right of the API token.";
  }
  const hints = classify(name);
  if (hints.readOnlyHint || NO_QUESTION.has(name)) return null;
  if (hints.destructiveHint) return DESTRUCTIVE_REASON[verbOf(name)] ?? "It changes or removes existing data.";
  return SENSITIVE[name] ?? null;
}

/** Claude Code prompts on every call of a tool carrying this, in every permission mode. */
export const REQUIRES_USER_INTERACTION = "anthropic/requiresUserInteraction";

/** The same tools, each carrying its hints, and the approval marker when it asks. Throws if one cannot be classified. */
export function annotate(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    const annotated: Tool = { ...tool, annotations: { ...(tool.annotations ?? {}), ...classify(tool.name) } };
    if (confirmationReason(tool.name) !== null) {
      annotated._meta = { ...(tool._meta ?? {}), [REQUIRES_USER_INTERACTION]: true };
    }
    return annotated;
  });
}

export function isReadOnly(tool: Tool): boolean {
  return tool.annotations?.readOnlyHint === true;
}

/** What a client may see: everything, or in read-only mode the read-only tools. */
export function visibleTools(tools: Tool[], readOnly: boolean): Tool[] {
  return readOnly ? tools.filter(isReadOnly) : tools;
}

export class PolicyRefusal extends Error {}

/** Throws when `name` may not be called under the policy. */
export function assertAllowed(name: string, tools: Tool[], readOnly: boolean): void {
  if (!readOnly) return;
  const tool = tools.find((t) => t.name === name);
  if (tool && isReadOnly(tool)) return;
  throw new PolicyRefusal(
    `${name} is not available: INFOMANIAK_READ_ONLY is set and this tool ` +
      (tool ? "changes or discloses more than a read" : "is unknown") +
      ". Unset INFOMANIAK_READ_ONLY to allow it.",
  );
}

export function readOnlyFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.INFOMANIAK_READ_ONLY ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Who asks the person before a tool that needs approval:
 * - `elicitation` (default): the server asks, through MCP elicitation, and
 *   refuses the call when the client cannot ask or the person does not say yes;
 * - `client`: the server leaves it to the client's own permission prompt
 *   (Claude Code shows it on every call of these tools, see annotate()).
 */
export type ConfirmMode = "elicitation" | "client";

export function confirmModeFromEnv(env: NodeJS.ProcessEnv = process.env): ConfirmMode {
  const value = (env.INFOMANIAK_CONFIRM ?? "").trim().toLowerCase();
  if (value === "" || value === "elicitation") return "elicitation";
  if (value === "client") return "client";
  throw new Error(`INFOMANIAK_CONFIRM must be "elicitation" (default) or "client", not "${env.INFOMANIAK_CONFIRM}"`);
}
