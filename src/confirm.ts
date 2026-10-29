/**
 * Asking the person before a call that needs approval.
 *
 * The question goes out as an MCP elicitation: a request from the server to
 * the client, which shows it to the person and sends back their answer. The
 * model in between sees neither the question nor the answer, so it cannot
 * approve on the person's behalf — which an argument such as `confirm: true`
 * would let it do.
 *
 * Anything but an explicit yes stops the call before it reaches the API: a
 * client that cannot ask, a "no", a dismissed dialog, a timeout, a broken
 * connection.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { RequestId } from "@modelcontextprotocol/sdk/types.js";
import { PolicyRefusal } from "./policy.js";

/** How long the person has to answer. */
export const CONFIRM_TIMEOUT_MS = 10 * 60_000;

const MAX_SHOWN_CHARS = 2_000;

/** The arguments as the person reads them: secrets hidden, long text cut. */
export function describeInput(value: unknown, key = ""): unknown {
  if (/password/i.test(key) && value !== undefined) return "(hidden)";
  if (typeof value === "string" && value.length > MAX_SHOWN_CHARS) {
    return `${value.slice(0, MAX_SHOWN_CHARS)}… (${value.length - MAX_SHOWN_CHARS} more characters)`;
  }
  if (Array.isArray(value)) return value.map((item) => describeInput(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, describeInput(v, k)]),
    );
  }
  return value;
}

export function confirmationMessage(name: string, reason: string, input: unknown): string {
  return [
    `The assistant wants to run ${name} on your Infomaniak account.`,
    reason,
    "",
    "With these arguments:",
    JSON.stringify(describeInput(input), null, 2),
    "",
    "Tick the box and accept to run it. Anything else stops it.",
  ].join("\n");
}

const REQUESTED_SCHEMA = {
  type: "object" as const,
  properties: {
    confirm: {
      type: "boolean" as const,
      title: "Run this call",
      description: "Tick to let this call run on your Infomaniak account.",
      default: false,
    },
  },
  required: ["confirm"],
};

/** True when the client said, at initialization, that it can show a form to the person. */
export function canAsk(server: Server): boolean {
  const elicitation = server.getClientCapabilities()?.elicitation as Record<string, unknown> | undefined;
  if (!elicitation) return false;
  // `elicitation: {}` is the form mode of the 2025-06-18 revision.
  return elicitation.form !== undefined || Object.keys(elicitation).length === 0;
}

/**
 * Resolves when the person approved the call; throws a PolicyRefusal
 * otherwise, before anything is sent to the API.
 */
export async function confirmWithPerson(
  server: Server,
  call: { name: string; reason: string; input: unknown },
  options: { relatedRequestId?: RequestId; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  if (!canAsk(server)) {
    throw new PolicyRefusal(
      `${call.name} needs your approval, and this MCP client cannot ask for it (it does not support elicitation). ` +
        "Nothing was sent. To rely on the client's own permission prompt instead, set INFOMANIAK_CONFIRM=client.",
    );
  }
  let answer;
  try {
    answer = await server.elicitInput(
      { mode: "form", message: confirmationMessage(call.name, call.reason, call.input), requestedSchema: REQUESTED_SCHEMA },
      { relatedRequestId: options.relatedRequestId, signal: options.signal, timeout: options.timeoutMs ?? CONFIRM_TIMEOUT_MS },
    );
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new PolicyRefusal(`${call.name} was not approved (${why}). Nothing was sent.`);
  }
  if (answer.action !== "accept" || answer.content?.confirm !== true) {
    const what = answer.action === "accept" ? "left unticked" : answer.action === "decline" ? "declined" : "cancelled";
    throw new PolicyRefusal(`${call.name} was ${what} by the person. Nothing was sent.`);
  }
}
