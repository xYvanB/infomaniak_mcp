/**
 * Mail tools, on the routes Infomaniak documents.
 *
 * The API addresses a mail service as a *mail hosting* and a mailbox by its
 * *name* (the part before the @), under
 * `/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/...`. There is
 * no numeric mailbox id anywhere in the API, which is why the tools take
 * `mailbox_name`. Every route here is checked against the published OpenAPI
 * document by src/api-routes.contract.test.ts.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { InfomaniakClient } from "./infomaniak-client.js";
import { handler, id, input, notOnlyDots, ToolHandler, validate } from "./schemas.js";

// ── schemas ──────────────────────────────────────────────────────────────────

const mailHostingId = id("mail_hosting_id");
// The username part of an address: no "@", no "/", and not "." or "..",
// nothing that would leave the path segment it is sent in.
const mailboxName = z
  .string({ required_error: "mailbox_name is required" })
  .min(1, "mailbox_name cannot be empty")
  .max(64, "mailbox_name is at most 64 characters")
  .regex(/^[A-Za-z0-9._+-]+$/, "mailbox_name is the part before the @ (letters, digits, . _ + -)")
  .refine(notOnlyDots, "mailbox_name cannot be only dots");
const email = z.string().email();

export const ListMailHostingsSchema = input({
  account_id: id("account_id").optional(),
});

export const MailHostingIdSchema = input({ mail_hosting_id: mailHostingId });

export const ListMailboxesSchema = input({
  mail_hosting_id: mailHostingId,
  search: z.string().min(1).optional(),
  page: z.number().int().min(1).optional(),
  per_page: z.number().int().min(1).max(500).optional(),
});

export const MailboxNameSchema = input({
  mail_hosting_id: mailHostingId,
  mailbox_name: mailboxName,
});

export const CreateMailboxSchema = input({
  mail_hosting_id: mailHostingId,
  mailbox_name: mailboxName,
  note: z.string().max(80).optional(),
  target: z.enum(["current_user", "ksuite_user", "other_user"]).optional(),
  link_to_current_user: z.boolean().optional(),
});

export const UpdateMailboxSchema = input({
  mail_hosting_id: mailHostingId,
  mailbox_name: mailboxName,
  note: z.string().max(80).optional(),
  has_responder: z.boolean().optional(),
  has_move_spam: z.boolean().optional(),
  has_mail_filtering: z.boolean().optional(),
  authorized_senders: z.array(z.string().min(1).max(512)).optional(),
  blocked_senders: z.array(z.string().min(1).max(512)).optional(),
});

export const MailboxAliasSchema = input({
  mail_hosting_id: mailHostingId,
  mailbox_name: mailboxName,
  alias: z
    .string({ required_error: "alias is required" })
    .min(1, "alias cannot be empty")
    .max(64, "alias is at most 64 characters")
    .regex(/^[A-Za-z0-9._+-]+$/, "alias is the part before the @ (letters, digits, . _ + -)")
    .refine(notOnlyDots, "alias cannot be only dots"),
});

export const AddMailboxForwardingSchema = input({
  mail_hosting_id: mailHostingId,
  mailbox_name: mailboxName,
  redirect_address: email,
});

export const UpdateMailboxForwardingSchema = input({
  mail_hosting_id: mailHostingId,
  mailbox_name: mailboxName,
  redirect_addresses: z.array(email).optional(),
  is_enabled: z.boolean().optional(),
  has_dont_deliver: z.boolean().optional(),
  has_forward_spam: z.boolean().optional(),
});

export const CreateRedirectionSchema = input({
  mail_hosting_id: mailHostingId,
  name: z.string({ required_error: "name is required" }).min(1),
  targets: z.array(email.max(255)).min(1, "at least one target address is required"),
});

export const RedirectionIdSchema = input({
  mail_hosting_id: mailHostingId,
  redirection_id: z.string({ required_error: "redirection_id is required" }).min(1).refine(notOnlyDots, "redirection_id cannot be only dots"),
});

const autoReplyFields = {
  name: z.string().min(1).optional(),
  message: z.string().min(1).max(65536).optional(),
  is_recurrent: z.boolean().optional(),
  started_at: z.number().int().optional(),
  ended_at: z.number().int().optional(),
  dont_reply_to: z.array(email).optional(),
  is_visible: z.boolean().optional(),
};

export const CreateAutoReplySchema = input({
  mail_hosting_id: mailHostingId,
  name: z.string({ required_error: "name is required" }).min(1),
  message: z.string({ required_error: "message is required" }).min(1).max(65536),
  is_recurrent: z.boolean().default(false),
  started_at: autoReplyFields.started_at,
  ended_at: autoReplyFields.ended_at,
  dont_reply_to: autoReplyFields.dont_reply_to,
  is_visible: autoReplyFields.is_visible,
});

export const AutoReplyIdSchema = input({
  mail_hosting_id: mailHostingId,
  auto_reply_id: id("auto_reply_id"),
});

export const UpdateAutoReplySchema = AutoReplyIdSchema.extend(autoReplyFields);

// ── tool definitions ─────────────────────────────────────────────────────────

const hosting = { mail_hosting_id: { type: "number", description: "The mail hosting (mail service) ID — see infomaniak_list_mail_hostings" } };
const mailbox = {
  ...hosting,
  mailbox_name: { type: "string", description: "The mailbox name: the part of the address before the @" },
};

export const mailTools: Tool[] = [
  {
    name: "infomaniak_list_mail_hostings",
    description: "List the mail hostings (mail services) the token can see, optionally for one account",
    inputSchema: {
      type: "object",
      properties: { account_id: { type: "number", description: "Restrict to this account ID (optional)" } },
      required: [],
    },
  },
  {
    name: "infomaniak_list_mailboxes",
    description: "List the mailboxes of a mail hosting",
    inputSchema: {
      type: "object",
      properties: {
        ...hosting,
        search: { type: "string", description: "Filter by name (optional)" },
        page: { type: "number", description: "Page number (optional)" },
        per_page: { type: "number", description: "Items per page (optional)" },
      },
      required: ["mail_hosting_id"],
    },
  },
  {
    name: "infomaniak_get_mailbox",
    description: "Get a mailbox: size, aliases, forwarding, auto-responder, senders lists",
    inputSchema: { type: "object", properties: mailbox, required: ["mail_hosting_id", "mailbox_name"] },
  },
  {
    name: "infomaniak_create_mailbox",
    description: "Create a mailbox on a mail hosting. The password is set afterwards by its user through the Manager, not here.",
    inputSchema: {
      type: "object",
      properties: {
        ...mailbox,
        note: { type: "string", description: "Internal note (optional)" },
        target: { type: "string", enum: ["current_user", "ksuite_user", "other_user"], description: "Who gets access at creation (optional)" },
        link_to_current_user: { type: "boolean", description: "Link the mailbox to the current user (optional)" },
      },
      required: ["mail_hosting_id", "mailbox_name"],
    },
  },
  {
    name: "infomaniak_update_mailbox",
    description: "Update a mailbox's settings: note, auto-responder on/off, spam handling, mail filtering, authorized and blocked senders",
    inputSchema: {
      type: "object",
      properties: {
        ...mailbox,
        note: { type: "string" },
        has_responder: { type: "boolean", description: "Auto-responder on or off" },
        has_move_spam: { type: "boolean", description: "Move spam to the spam folder" },
        has_mail_filtering: { type: "boolean", description: "Sort commercial and social-network mail into folders" },
        authorized_senders: { type: "array", items: { type: "string" } },
        blocked_senders: { type: "array", items: { type: "string" } },
      },
      required: ["mail_hosting_id", "mailbox_name"],
    },
  },
  {
    name: "infomaniak_delete_mailbox",
    description: "Delete a mailbox and everything in it",
    inputSchema: { type: "object", properties: mailbox, required: ["mail_hosting_id", "mailbox_name"] },
  },
  {
    name: "infomaniak_list_mailbox_aliases",
    description: "List the aliases of a mailbox",
    inputSchema: { type: "object", properties: mailbox, required: ["mail_hosting_id", "mailbox_name"] },
  },
  {
    name: "infomaniak_add_mailbox_alias",
    description: "Add an alias (the part before the @) to a mailbox",
    inputSchema: {
      type: "object",
      properties: { ...mailbox, alias: { type: "string", description: "The alias name, without domain" } },
      required: ["mail_hosting_id", "mailbox_name", "alias"],
    },
  },
  {
    name: "infomaniak_delete_mailbox_alias",
    description: "Remove an alias from a mailbox",
    inputSchema: {
      type: "object",
      properties: { ...mailbox, alias: { type: "string", description: "The alias name, without domain" } },
      required: ["mail_hosting_id", "mailbox_name", "alias"],
    },
  },
  {
    name: "infomaniak_get_mailbox_forwarding",
    description: "Get the forwarding settings of a mailbox (addresses, enabled, keep a copy, forward spam)",
    inputSchema: { type: "object", properties: mailbox, required: ["mail_hosting_id", "mailbox_name"] },
  },
  {
    name: "infomaniak_add_mailbox_forwarding",
    description: "Add a forwarding address to a mailbox",
    inputSchema: {
      type: "object",
      properties: { ...mailbox, redirect_address: { type: "string", description: "The address to forward to" } },
      required: ["mail_hosting_id", "mailbox_name", "redirect_address"],
    },
  },
  {
    name: "infomaniak_update_mailbox_forwarding",
    description: "Update a mailbox's forwarding: the list of addresses, enabled, keep a local copy, forward spam. Disabling drops the addresses.",
    inputSchema: {
      type: "object",
      properties: {
        ...mailbox,
        redirect_addresses: { type: "array", items: { type: "string" } },
        is_enabled: { type: "boolean" },
        has_dont_deliver: { type: "boolean", description: "Delete locally after forwarding" },
        has_forward_spam: { type: "boolean" },
      },
      required: ["mail_hosting_id", "mailbox_name"],
    },
  },
  {
    name: "infomaniak_delete_mailbox_forwarding",
    description: "Remove every forwarding address from a mailbox",
    inputSchema: { type: "object", properties: mailbox, required: ["mail_hosting_id", "mailbox_name"] },
  },
  {
    name: "infomaniak_list_email_redirections",
    description: "List the redirections (addresses that only forward, without a mailbox) of a mail hosting",
    inputSchema: { type: "object", properties: hosting, required: ["mail_hosting_id"] },
  },
  {
    name: "infomaniak_create_email_redirection",
    description: "Create a redirection: an address of the hosting that forwards to one or more targets",
    inputSchema: {
      type: "object",
      properties: {
        ...hosting,
        name: { type: "string", description: "The redirection's name (the part before the @)" },
        targets: { type: "array", items: { type: "string" }, description: "Addresses that receive the mail" },
      },
      required: ["mail_hosting_id", "name", "targets"],
    },
  },
  {
    name: "infomaniak_delete_email_redirection",
    description: "Delete a redirection",
    inputSchema: {
      type: "object",
      properties: { ...hosting, redirection_id: { type: "string", description: "The redirection ID" } },
      required: ["mail_hosting_id", "redirection_id"],
    },
  },
  {
    name: "infomaniak_list_auto_replies",
    description: "List the auto-replies (out-of-office messages) defined on a mail hosting",
    inputSchema: { type: "object", properties: hosting, required: ["mail_hosting_id"] },
  },
  {
    name: "infomaniak_create_auto_reply",
    description: "Create an auto-reply on a mail hosting; switch it on for a mailbox with infomaniak_update_mailbox has_responder",
    inputSchema: {
      type: "object",
      properties: {
        ...hosting,
        name: { type: "string" },
        message: { type: "string" },
        is_recurrent: { type: "boolean", description: "Active on given weekdays rather than between two dates (default false)" },
        started_at: { type: "number", description: "Unix timestamp (optional)" },
        ended_at: { type: "number", description: "Unix timestamp (optional)" },
        dont_reply_to: { type: "array", items: { type: "string" }, description: "Addresses never answered (optional)" },
        is_visible: { type: "boolean" },
      },
      required: ["mail_hosting_id", "name", "message"],
    },
  },
  {
    name: "infomaniak_update_auto_reply",
    description: "Update an auto-reply",
    inputSchema: {
      type: "object",
      properties: {
        ...hosting,
        auto_reply_id: { type: "number" },
        name: { type: "string" },
        message: { type: "string" },
        is_recurrent: { type: "boolean" },
        started_at: { type: "number" },
        ended_at: { type: "number" },
        dont_reply_to: { type: "array", items: { type: "string" } },
        is_visible: { type: "boolean" },
      },
      required: ["mail_hosting_id", "auto_reply_id"],
    },
  },
  {
    name: "infomaniak_delete_auto_reply",
    description: "Delete an auto-reply",
    inputSchema: {
      type: "object",
      properties: { ...hosting, auto_reply_id: { type: "number" } },
      required: ["mail_hosting_id", "auto_reply_id"],
    },
  },
  {
    name: "infomaniak_list_mailbox_folders",
    description: "List the IMAP folders of a mailbox and which ones hold drafts, sent, trash, spam and archives",
    inputSchema: { type: "object", properties: mailbox, required: ["mail_hosting_id", "mailbox_name"] },
  },
];

export const MAIL_TOOL_NAMES: ReadonlySet<string> = new Set(mailTools.map((t) => t.name));

// ── handlers ─────────────────────────────────────────────────────────────────

function withoutUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const on = <S extends z.ZodTypeAny>(schema: S, run: (input: z.output<S>, client: InfomaniakClient) => Promise<unknown>) =>
  handler(schema, run);

/** Each mail tool's input schema and what it does with the validated input. */
export const mailHandlers: Record<string, ToolHandler<InfomaniakClient>> = {
  infomaniak_list_mail_hostings: on(ListMailHostingsSchema, (v, client) => client.getMailHostings(v.account_id)),
  infomaniak_list_mailboxes: on(ListMailboxesSchema, (v, client) =>
    client.getMailboxes(v.mail_hosting_id, withoutUndefined({ search: v.search, page: v.page, per_page: v.per_page }))),
  infomaniak_get_mailbox: on(MailboxNameSchema, (v, client) => client.getMailbox(v.mail_hosting_id, v.mailbox_name)),
  infomaniak_create_mailbox: on(CreateMailboxSchema, ({ mail_hosting_id, mailbox_name, ...rest }, client) =>
    client.createMailbox(mail_hosting_id, { mailbox_name, ...withoutUndefined(rest) })),
  infomaniak_update_mailbox: on(UpdateMailboxSchema, ({ mail_hosting_id, mailbox_name, ...changes }, client) =>
    client.updateMailbox(mail_hosting_id, mailbox_name, withoutUndefined(changes))),
  infomaniak_delete_mailbox: on(MailboxNameSchema, (v, client) => client.deleteMailbox(v.mail_hosting_id, v.mailbox_name)),
  infomaniak_list_mailbox_aliases: on(MailboxNameSchema, (v, client) => client.getMailboxAliases(v.mail_hosting_id, v.mailbox_name)),
  infomaniak_add_mailbox_alias: on(MailboxAliasSchema, (v, client) => client.addMailboxAlias(v.mail_hosting_id, v.mailbox_name, v.alias)),
  infomaniak_delete_mailbox_alias: on(MailboxAliasSchema, (v, client) => client.deleteMailboxAlias(v.mail_hosting_id, v.mailbox_name, v.alias)),
  infomaniak_get_mailbox_forwarding: on(MailboxNameSchema, (v, client) => client.getMailboxForwarding(v.mail_hosting_id, v.mailbox_name)),
  infomaniak_add_mailbox_forwarding: on(AddMailboxForwardingSchema, (v, client) =>
    client.addMailboxForwarding(v.mail_hosting_id, v.mailbox_name, v.redirect_address)),
  infomaniak_update_mailbox_forwarding: on(UpdateMailboxForwardingSchema, ({ mail_hosting_id, mailbox_name, ...changes }, client) =>
    client.updateMailboxForwarding(mail_hosting_id, mailbox_name, withoutUndefined(changes))),
  infomaniak_delete_mailbox_forwarding: on(MailboxNameSchema, (v, client) => client.deleteMailboxForwarding(v.mail_hosting_id, v.mailbox_name)),
  infomaniak_list_email_redirections: on(MailHostingIdSchema, (v, client) => client.getRedirections(v.mail_hosting_id)),
  infomaniak_create_email_redirection: on(CreateRedirectionSchema, (v, client) =>
    client.createRedirection(v.mail_hosting_id, { name: v.name, targets: v.targets })),
  infomaniak_delete_email_redirection: on(RedirectionIdSchema, (v, client) => client.deleteRedirection(v.mail_hosting_id, v.redirection_id)),
  infomaniak_list_auto_replies: on(MailHostingIdSchema, (v, client) => client.getAutoReplies(v.mail_hosting_id)),
  infomaniak_create_auto_reply: on(CreateAutoReplySchema, ({ mail_hosting_id, name, message, is_recurrent, ...rest }, client) =>
    client.createAutoReply(mail_hosting_id, { name, message, is_recurrent, ...withoutUndefined(rest) })),
  infomaniak_update_auto_reply: on(UpdateAutoReplySchema, ({ mail_hosting_id, auto_reply_id, ...changes }, client) =>
    client.updateAutoReply(mail_hosting_id, auto_reply_id, withoutUndefined(changes))),
  infomaniak_delete_auto_reply: on(AutoReplyIdSchema, (v, client) => client.deleteAutoReply(v.mail_hosting_id, v.auto_reply_id)),
  infomaniak_list_mailbox_folders: on(MailboxNameSchema, (v, client) => client.getMailboxFolders(v.mail_hosting_id, v.mailbox_name)),
};

/** Validates `args` against the tool's schema, then runs it. */
export async function handleMailTool(
  client: InfomaniakClient,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<unknown> {
  const tool = mailHandlers[name];
  if (!tool) throw new Error(`Unknown mail tool: ${name}`);
  return tool.run(validate(tool.schema, args ?? {}), client);
}
