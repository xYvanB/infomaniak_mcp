/**
 * What a client is told a tool takes, and what the server accepts, are the
 * same thing — and nothing a tool accepts can reach another route than its own.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions, tools, annotatedTools, annotatedImapTools, inputSchemas } from "./server.js";
import { mailTools, MailboxAliasSchema, MailboxNameSchema, RedirectionIdSchema } from "./mail-tools.js";
import { imapTools } from "./imap-tools.js";
import { confirmationReason, REQUIRES_USER_INTERACTION } from "./policy.js";
import { InfomaniakClient } from "./infomaniak-client.js";
import { KChatClient } from "./kchat-client.js";
import {
  validate,
  AccountIdSchema,
  ApiCallSchema,
  DeleteDnsRecordSchema,
  KChatPostIdSchema,
  ListKDriveFilesSchema,
  ShareKDriveFileSchema,
  UpdateDnsRecordSchema,
} from "./schemas.js";
import { ReplayServer } from "./test-support/replay-server.js";

type JsonProperty = { type?: string | string[]; enum?: unknown[] };
type JsonObject = { properties?: Record<string, JsonProperty>; required?: string[]; additionalProperties?: unknown };

const defined: Tool[] = [...toolDefinitions, ...imapTools];

describe("every tool", () => {
  it("has exactly one handler, and every handler a tool", () => {
    const names = defined.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...inputSchemas.keys()].sort()).toEqual([...names].sort());
    expect(toolDefinitions.filter((t) => mailTools.includes(t))).toHaveLength(mailTools.length);
  });

  it.each(defined.map((t) => [t.name, t] as const))("%s: its definition says what its zod schema accepts", (name, tool) => {
    const zod = zodToJsonSchema(inputSchemas.get(name)!, { $refStrategy: "none" }) as JsonObject;
    const doc = tool.inputSchema as JsonObject;
    const zodProps = zod.properties ?? {};
    const docProps = doc.properties ?? {};
    expect(Object.keys(docProps).sort(), "properties").toEqual(Object.keys(zodProps).sort());
    expect([...(doc.required ?? [])].sort(), "required").toEqual([...(zod.required ?? [])].sort());
    for (const [key, prop] of Object.entries(docProps)) {
      const expected = zodProps[key];
      // "number" documents an integer too; the published schema says "integer".
      const docType = prop.type === "number" && expected.type === "integer" ? "integer" : prop.type;
      expect(docType, `${key}: type`).toEqual(expected.type);
      if (expected.enum) expect(prop.enum, `${key}: enum`).toEqual(expected.enum);
    }
  });

  it("is published with its zod-derived schema: keys it does not declare are refused", () => {
    expect(tools.length + annotatedImapTools.length).toBe(defined.length);
    for (const tool of [...tools, ...annotatedImapTools]) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(tool.inputSchema, tool.name).not.toHaveProperty("$schema");
      // JSON Schema 2020-12, which MCP clients expect, has no array-valued `items`.
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toMatch(/"items":\[/);
      // Every published pattern compiles as the ECMAScript regex JSON Schema says it is.
      const patterns: string[] = [];
      JSON.stringify(tool.inputSchema, (key, value) => (key === "pattern" && typeof value === "string" ? patterns.push(value) : 0, value));
      for (const pattern of patterns) expect(() => new RegExp(pattern), `${tool.name}: ${pattern}`).not.toThrow();
    }
    const share = tools.find((t) => t.name === "infomaniak_share_kdrive_file")!.inputSchema as JsonObject & { properties: Record<string, { description?: string; maximum?: number }> };
    expect(share.properties.valid_until).toMatchObject({ type: "integer", maximum: 253402300799 });
    expect(share.properties.valid_until.description).toMatch(/Unix timestamp/);
  });

  it("carries Claude Code's approval marker exactly when it needs approval", () => {
    for (const tool of annotatedTools) {
      const marked = (tool._meta as Record<string, unknown> | undefined)?.[REQUIRES_USER_INTERACTION] === true;
      expect(marked, tool.name).toBe(confirmationReason(tool.name) !== null);
    }
  });
});

describe("the tools that need a person's approval", () => {
  it("are exactly these: destructive, outward-reaching, costly or code-running", () => {
    const asking = defined.map((t) => t.name).filter((name) => confirmationReason(name) !== null).sort();
    expect(asking).toEqual([
      "infomaniak_add_mailbox_forwarding",
      "infomaniak_api_call",
      "infomaniak_create_cron_job",
      "infomaniak_create_dns_record",
      "infomaniak_create_email_redirection",
      "infomaniak_create_ftp_account",
      "infomaniak_delete_auto_reply",
      "infomaniak_delete_cron_job",
      "infomaniak_delete_database",
      "infomaniak_delete_dns_record",
      "infomaniak_delete_email_redirection",
      "infomaniak_delete_ftp_account",
      "infomaniak_delete_kdrive_file",
      "infomaniak_delete_mailbox",
      "infomaniak_delete_mailbox_alias",
      "infomaniak_delete_mailbox_forwarding",
      "infomaniak_delete_site",
      "infomaniak_empty_kdrive_trash",
      "infomaniak_kchat_create_post",
      "infomaniak_kchat_delete_post",
      "infomaniak_move_kdrive_file",
      "infomaniak_reboot_dedicated_server",
      "infomaniak_reboot_vps",
      "infomaniak_rename_kdrive_file",
      "infomaniak_renew_domain",
      "infomaniak_share_kdrive_file",
      "infomaniak_shutdown_vps",
      "infomaniak_update_auto_reply",
      "infomaniak_update_cron_job",
      "infomaniak_update_dns_record",
      "infomaniak_update_domain_nameservers",
      "infomaniak_update_ftp_account",
      "infomaniak_update_mailbox",
      "infomaniak_update_mailbox_forwarding",
      "infomaniak_update_site",
    ]);
  });

  it("leave these writes to run without asking: they only add, inside the account", () => {
    const writesThatRun = defined
      .filter((t) => !t.annotations?.readOnlyHint && !annotatedTools.find((a) => a.name === t.name)?.annotations?.readOnlyHint)
      .map((t) => t.name)
      .filter((name) => confirmationReason(name) === null && !["list", "get", "search", "download", "ping"].includes(name.replace(/^infomaniak_(kchat_)?/, "").split("_")[0]))
      .sort();
    expect(writesThatRun).toEqual([
      "infomaniak_add_kdrive_favorite",
      "infomaniak_add_mailbox_alias",
      "infomaniak_boot_vps",
      "infomaniak_copy_kdrive_file",
      "infomaniak_create_auto_reply",
      "infomaniak_create_database",
      "infomaniak_create_kdrive_directory",
      "infomaniak_create_mailbox",
      "infomaniak_create_site",
      "infomaniak_kchat_create_direct",
      "infomaniak_remove_kdrive_favorite",
      "infomaniak_restore_kdrive_file",
      "infomaniak_upload_kdrive_file",
    ]);
  });
});

describe("input that would reach another route", () => {
  it.each(["x.com/../../2/drive/1/trash", "../x.com", "x.com?y=1", "x.com#y", "x%2F.com", "x..com", "localhost", ""])(
    "a domain %j is refused",
    (domain) => {
      expect(() => validate(DeleteDnsRecordSchema, { domain, record_id: 1 })).toThrow(/domain/);
    },
  );

  it("a domain name, IDN included, is accepted", () => {
    for (const domain of ["example.com", "sub.example.co.uk", "café.ch", "xn--caf-dma.ch"]) {
      expect(validate(DeleteDnsRecordSchema, { domain, record_id: 1 }).domain).toBe(domain);
    }
  });

  it("a kChat id is letters and digits", () => {
    expect(() => validate(KChatPostIdSchema, { post_id: "abc/../users" })).toThrow(/post_id/);
    expect(validate(KChatPostIdSchema, { post_id: "x1y2z3" }).post_id).toBe("x1y2z3");
  });

  it.each([".", "..", "..."])("a mailbox name, an alias or a redirection id %j is refused: the URL parser would resolve it", (dots) => {
    expect(() => validate(MailboxNameSchema, { mail_hosting_id: 1, mailbox_name: dots })).toThrow(/mailbox_name/);
    expect(() => validate(MailboxAliasSchema, { mail_hosting_id: 1, mailbox_name: "user1", alias: dots })).toThrow(/alias/);
    expect(() => validate(RedirectionIdSchema, { mail_hosting_id: 1, redirection_id: dots })).toThrow(/redirection_id/);
  });

  it("the raw API call takes a plain path, not a traversal, a query or a fragment", () => {
    for (const endpoint of [
      "/1/domain/../../2/drive/1/trash", "/1/./x", "/1/x/%2e%2e/2", "/1/x/%2E%2e/2", "/1/x/.%2e/2", "/1/x/%2e/2",
      "/1/x?y=1", "/1/x#y", "/1/x y", "/1\\x", "1/x",
    ]) {
      expect(() => validate(ApiCallSchema, { method: "GET", endpoint }), endpoint).toThrow(/endpoint/);
    }
    expect(validate(ApiCallSchema, { method: "GET", endpoint: "/1/account" }).endpoint).toBe("/1/account");
  });

  it("an id is a positive integer", () => {
    expect(() => validate(AccountIdSchema, { account_id: 1.5 })).toThrow(/integer/);
    expect(() => validate(UpdateDnsRecordSchema, { domain: "example.com", record_id: 2.5 })).toThrow(/record_id/);
  });

  it("a key the tool does not take is refused, not dropped", () => {
    expect(() => validate(UpdateDnsRecordSchema, { domain: "example.com", record_id: 1, targt: "1.2.3.4" })).toThrow(/targt/);
  });
});

describe("the documented kDrive constraints", () => {
  it("a share link is public or password-protected, with an expiry as a Unix timestamp", () => {
    expect(validate(ShareKDriveFileSchema, { drive_id: 1, file_id: 2 })).toEqual({ drive_id: 1, file_id: 2, right: "public" });
    expect(() => validate(ShareKDriveFileSchema, { drive_id: 1, file_id: 2, right: "inherit" })).toThrow(/right/);
    expect(() => validate(ShareKDriveFileSchema, { drive_id: 1, file_id: 2, valid_until: "2026-12-31" })).toThrow(/valid_until/);
    expect(() => validate(ShareKDriveFileSchema, { drive_id: 1, file_id: 2, right: "password" })).toThrow(/password/);
    expect(() => validate(ShareKDriveFileSchema, { drive_id: 1, file_id: 2, password: "x" })).toThrow(/password/);
    expect(validate(ShareKDriveFileSchema, { drive_id: 1, file_id: 2, right: "password", password: "x", valid_until: 1798675200 }))
      .toMatchObject({ right: "password", password: "x", valid_until: 1798675200 });
  });

  it("a listing page holds 5 to 1000 entries", () => {
    expect(() => validate(ListKDriveFilesSchema, { drive_id: 1, limit: 4 })).toThrow(/limit/);
    expect(validate(ListKDriveFilesSchema, { drive_id: 1, limit: 5 }).limit).toBe(5);
  });
});

describe("the clients encode what they put in a path", () => {
  const replay = new ReplayServer();
  let api: InfomaniakClient;
  beforeAll(async () => {
    api = new InfomaniakClient({ token: "test-token", baseUrl: await replay.start(), maxAttempts: 1 });
  });
  afterAll(() => replay.stop());
  beforeEach(() => replay.requests.splice(0));

  it("a domain stays in its segment even when handed to the client directly", async () => {
    await api.deleteDnsRecord("x.com/../../2/drive/1/trash", 1).catch(() => undefined);
    expect(replay.requests).toHaveLength(1);
    expect(replay.requests[0].path).toBe("/1/domain/x.com%2F..%2F..%2F2%2Fdrive%2F1%2Ftrash/dns/record/1");
  });

  it("a dot segment is refused before any request: deleting alias \"..\" would delete the mailbox", async () => {
    await expect(api.deleteMailboxAlias(1, "user1", "..")).rejects.toThrow(/path segment/);
    await expect(api.deleteMailboxAlias(1, "user1", ".")).rejects.toThrow(/path segment/);
    await expect(api.deleteRedirection(1, "..")).rejects.toThrow(/path segment/);
    await expect(api.deleteMailbox(1, "..")).rejects.toThrow(/path segment/);
    expect(replay.requests).toHaveLength(0);
  });

  it("a kChat id stays in its segment", async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      await new KChatClient({ host: "chat.example.com", token: "t" }).deletePost("a/../../users/me");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual(["https://chat.example.com/api/v4/posts/a%2F..%2F..%2Fusers%2Fme"]);
  });
});
