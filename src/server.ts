/**
 * Shared MCP Server Factory
 *
 * Creates and configures the MCP server with all tool definitions and handlers.
 * This module is transport-agnostic and can be used with stdio or HTTP transports.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { InfomaniakClient, KDRIVE_LANGS, KDRIVE_ROOT_ID } from "./infomaniak-client.js";
import { KChatClient } from "./kchat-client.js";
import { mailTools, mailHandlers } from "./mail-tools.js";
import { annotate, assertAllowed, ConfirmMode, confirmationReason, PolicyRefusal, visibleTools } from "./policy.js";
import { confirmWithPerson } from "./confirm.js";
import { ImapReader, imapTools, imapHandlers, requireImapReader } from "./imap-tools.js";
import {
  ToolContent,
  MAX_BINARY_BYTES,
  MAX_TEXT_CHARS,
  DEFAULT_TEXT_CHARS,
  binaryToContent,
  decodeBase64,
  isTextLike,
  textFileToContent,
} from "./content.js";
import {
  validate,
  handler,
  toInputSchema,
  ToolHandler,
  NoInputSchema,
  AccountIdSchema,
  GetDomainSchema,
  ListDnsRecordsSchema,
  CreateDnsRecordSchema,
  UpdateDnsRecordSchema,
  DeleteDnsRecordSchema,
  HostingIdSchema,
  SiteIdSchema,
  CreateSiteSchema,
  UpdateSiteSchema,
  DeleteSiteSchema,
  DatabaseIdSchema,
  CreateDatabaseSchema,
  DeleteDatabaseSchema,
  DriveIdSchema,
  BackupIdSchema,
  VpsIdSchema,
  ServerIdSchema,
  CertificateIdSchema,
  InvoiceIdSchema,
  ApiCallSchema,
  GetDomainNameserversSchema,
  UpdateDomainNameserversSchema,
  RenewDomainSchema,
  CronJobIdSchema,
  CreateCronJobSchema,
  UpdateCronJobSchema,
  FtpAccountIdSchema,
  CreateFtpAccountSchema,
  UpdateFtpAccountSchema,
  KDriveFileIdSchema,
  ListKDriveFilesSchema,
  SearchKDriveFilesSchema,
  CreateKDriveDirectorySchema,
  MoveOrCopyKDriveFileSchema,
  RenameKDriveFileSchema,
  ShareKDriveFileSchema,
  KDriveTrashSchema,
  KDriveActivitySchema,
  KDriveFavoritesSchema,
  KDriveRestoreFileSchema,
  DownloadKDriveFileSchema,
  UploadKDriveFileSchema,
  KChatTeamIdSchema,
  KChatChannelIdSchema,
  KChatPostIdSchema,
  CreateKChatPostSchema,
  SearchKChatPostsSchema,
  CreateKChatDirectChannelSchema,
  SearchKChatUsersSchema,
  ListKChatUsersSchema,
  KChatGetChannelPostsSchema,
} from "./schemas.js";

/**
 * Tool definitions for the Infomaniak MCP server: names, descriptions, and
 * the descriptions of their parameters. The input schema clients see is
 * derived from each tool's zod schema (see `tools` below), so the types,
 * limits and required keys written here are documentation; a test holds
 * them to the zod schema.
 */
export const toolDefinitions: Tool[] = [
  ...mailTools,
  // Profile & Account Tools
  {
    name: "infomaniak_ping",
    description: "Test connectivity with the Infomaniak API",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_get_profile",
    description: "Get the current user profile information",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_list_accounts",
    description: "List all accounts accessible by the current user",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_get_account",
    description: "Get detailed information about a specific account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_list_products",
    description: "List all products for a specific account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },

  // Domain Tools
  {
    name: "infomaniak_list_domains",
    description: "List all domains for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_domain",
    description: "Get detailed information about a specific domain",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
        domain: {
          type: "string",
          description: "The domain name (e.g., example.com)",
        },
      },
      required: ["account_id", "domain"],
    },
  },
  {
    name: "infomaniak_get_domain_nameservers",
    description: "Get the nameservers for a domain",
    inputSchema: { type: "object", properties: { domain: { type: "string", description: "The domain name" } }, required: ["domain"] },
  },
  {
    name: "infomaniak_update_domain_nameservers",
    description: "Update the nameservers for a domain",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        nameservers: { type: "array", items: { type: "object", properties: { host: { type: "string" }, ip: { type: "string" } }, required: ["host"] } },
      },
      required: ["domain", "nameservers"],
    },
  },
  {
    name: "infomaniak_renew_domain",
    description: "Renew a domain for a given number of years",
    inputSchema: { type: "object", properties: { domain: { type: "string" }, duration: { type: "number", description: "Renewal duration in years" } }, required: ["domain", "duration"] },
  },
  {
    name: "infomaniak_list_dns_records",
    description: "List all DNS records for a domain",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain name (e.g., example.com)",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "infomaniak_create_dns_record",
    description: "Create a new DNS record for a domain",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain name (e.g., example.com)",
        },
        source: {
          type: "string",
          description: "The subdomain or @ for root (e.g., www, mail, @)",
        },
        type: {
          type: "string",
          description: "DNS record type (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA)",
          enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"],
        },
        target: {
          type: "string",
          description: "The target value (IP address, hostname, or text)",
        },
        ttl: {
          type: "number",
          description: "Time to live in seconds (default: 3600)",
        },
        priority: {
          type: "number",
          description: "Priority for MX/SRV records",
        },
      },
      required: ["domain", "source", "type", "target"],
    },
  },
  {
    name: "infomaniak_update_dns_record",
    description: "Update an existing DNS record",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain name",
        },
        record_id: {
          type: "number",
          description: "The DNS record ID",
        },
        source: {
          type: "string",
          description: "The subdomain or @ for root",
        },
        type: {
          type: "string",
          description: "DNS record type",
          enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"],
        },
        target: {
          type: "string",
          description: "The target value",
        },
        ttl: {
          type: "number",
          description: "Time to live in seconds",
        },
        priority: {
          type: "number",
          description: "Priority for MX/SRV records",
        },
      },
      required: ["domain", "record_id"],
    },
  },
  {
    name: "infomaniak_delete_dns_record",
    description: "Delete a DNS record",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "The domain name",
        },
        record_id: {
          type: "number",
          description: "The DNS record ID to delete",
        },
      },
      required: ["domain", "record_id"],
    },
  },

  // Web Hosting Tools
  {
    name: "infomaniak_list_web_hostings",
    description: "List all web hostings for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_web_hosting",
    description: "Get detailed information about a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
      },
      required: ["hosting_id"],
    },
  },
  {
    name: "infomaniak_list_sites",
    description: "List all sites for a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
      },
      required: ["hosting_id"],
    },
  },
  {
    name: "infomaniak_get_site",
    description: "Get detailed information about a site",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        site_id: {
          type: "number",
          description: "The site ID",
        },
      },
      required: ["hosting_id", "site_id"],
    },
  },
  {
    name: "infomaniak_create_site",
    description: "Create a new site on a web hosting. This call can take more than 30 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        domain: {
          type: "string",
          description: "The fully qualified domain name for the site (e.g. example.com)",
        },
        directory: {
          type: "string",
          description: "The site directory on the hosting (optional, defaults to /sites/<domain>)",
        },
        php_version: {
          type: "string",
          description: "PHP version to use (optional)",
        },
        fqdn: {
          type: "string",
          description: "Deprecated alias of domain",
        },
        path: {
          type: "string",
          description: "Deprecated alias of directory",
        },
      },
      required: ["hosting_id"],
    },
  },
  {
    name: "infomaniak_update_site",
    description: "Update a site configuration",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        site_id: {
          type: "number",
          description: "The site ID",
        },
        path: {
          type: "string",
          description: "New document root path",
        },
        php_version: {
          type: "string",
          description: "New PHP version",
        },
      },
      required: ["hosting_id", "site_id"],
    },
  },
  {
    name: "infomaniak_delete_site",
    description: "Delete a site from web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        site_id: {
          type: "number",
          description: "The site ID to delete",
        },
      },
      required: ["hosting_id", "site_id"],
    },
  },

  // Database Tools
  {
    name: "infomaniak_list_databases",
    description: "List all databases for a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
      },
      required: ["hosting_id"],
    },
  },
  {
    name: "infomaniak_get_database",
    description: "Get detailed information about a database",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        database_id: {
          type: "number",
          description: "The database ID",
        },
      },
      required: ["hosting_id", "database_id"],
    },
  },
  {
    name: "infomaniak_create_database",
    description: "Create a new database",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        name: {
          type: "string",
          description: "Database name",
        },
        charset: {
          type: "string",
          description: "Character set (default: utf8mb4)",
        },
      },
      required: ["hosting_id", "name"],
    },
  },
  {
    name: "infomaniak_delete_database",
    description: "Delete a database",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: {
          type: "number",
          description: "The web hosting ID",
        },
        database_id: {
          type: "number",
          description: "The database ID to delete",
        },
      },
      required: ["hosting_id", "database_id"],
    },
  },

  {
    name: "infomaniak_list_cron_jobs",
    description: "List all cron jobs for a web hosting",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" } }, required: ["hosting_id"] },
  },
  {
    name: "infomaniak_create_cron_job",
    description: "Create a cron job on a web hosting",
    inputSchema: {
      type: "object",
      properties: {
        hosting_id: { type: "number" },
        command: { type: "string" },
        schedule: { type: "string", description: "Cron expression e.g. '0 * * * *'" },
        description: { type: "string" },
      },
      required: ["hosting_id", "command", "schedule"],
    },
  },
  {
    name: "infomaniak_update_cron_job",
    description: "Update a cron job",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, cron_id: { type: "number" }, command: { type: "string" }, schedule: { type: "string" }, description: { type: "string" } }, required: ["hosting_id", "cron_id"] },
  },
  {
    name: "infomaniak_delete_cron_job",
    description: "Delete a cron job",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, cron_id: { type: "number" } }, required: ["hosting_id", "cron_id"] },
  },
  {
    name: "infomaniak_list_ftp_accounts",
    description: "List all FTP accounts for a web hosting",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" } }, required: ["hosting_id"] },
  },
  {
    name: "infomaniak_create_ftp_account",
    description: "Create an FTP account",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, login: { type: "string" }, password: { type: "string" }, home_directory: { type: "string" } }, required: ["hosting_id", "login", "password"] },
  },
  {
    name: "infomaniak_update_ftp_account",
    description: "Update an FTP account",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, ftp_id: { type: "number" }, password: { type: "string" }, home_directory: { type: "string" }, is_active: { type: "boolean" } }, required: ["hosting_id", "ftp_id"] },
  },
  {
    name: "infomaniak_delete_ftp_account",
    description: "Delete an FTP account",
    inputSchema: { type: "object", properties: { hosting_id: { type: "number" }, ftp_id: { type: "number" } }, required: ["hosting_id", "ftp_id"] },
  },

  // kDrive Tools
  {
    name: "infomaniak_list_kdrives",
    description: "List all kDrives for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_kdrive",
    description: "Get detailed information about a kDrive",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: {
          type: "number",
          description: "The kDrive ID",
        },
      },
      required: ["drive_id"],
    },
  },

  {
    name: "infomaniak_list_kdrive_files",
    description: "List files in a kDrive directory. When the result has has_more=true, call again with its cursor for the next page.",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: { type: "number" },
        parent_id: { type: "number", description: "Parent directory ID (omit for the root directory, id 1)" },
        cursor: { type: "string", description: "Cursor from the previous page" },
        limit: { type: "number", description: "Entries per page (5-1000)" },
        type: { type: "string", enum: ["file", "dir"], description: "Only files or only directories" },
      },
      required: ["drive_id"],
    },
  },
  {
    name: "infomaniak_get_kdrive_file",
    description: "Get details about a file or directory in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_search_kdrive_files",
    description: "Search for files in a kDrive, optionally within one directory",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: { type: "number" },
        query: { type: "string" },
        directory_id: { type: "number", description: "Only search inside this directory" },
        depth: { type: "string", enum: ["unlimited", "child"], description: "With directory_id: whole subtree (unlimited) or direct children (child)" },
        limit: { type: "number", description: "Max results (5-1000)" },
      },
      required: ["drive_id", "query"],
    },
  },
  {
    name: "infomaniak_create_kdrive_directory",
    description: "Create a new directory in a kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, name: { type: "string" }, parent_id: { type: "number" } }, required: ["drive_id", "name"] },
  },
  {
    name: "infomaniak_move_kdrive_file",
    description: "Move a file or directory to another location in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" }, destination_directory_id: { type: "number" } }, required: ["drive_id", "file_id", "destination_directory_id"] },
  },
  {
    name: "infomaniak_copy_kdrive_file",
    description: "Copy a file or directory in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" }, destination_directory_id: { type: "number" } }, required: ["drive_id", "file_id", "destination_directory_id"] },
  },
  {
    name: "infomaniak_rename_kdrive_file",
    description: "Rename a file or directory in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" }, name: { type: "string" } }, required: ["drive_id", "file_id", "name"] },
  },
  {
    name: "infomaniak_delete_kdrive_file",
    description: "Delete a file or directory from kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_share_kdrive_file",
    description: "Create a share link for a file or directory in kDrive: anyone with the link can open it (with right=password, anyone who also has the password)",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: { type: "number" },
        file_id: { type: "number" },
        right: { type: "string", enum: ["public", "password"], description: "public (default) or password" },
        password: { type: "string", description: "The link's password; required with right=password, and only then" },
        valid_until: { type: "number", description: "Expiry as a Unix timestamp in seconds (optional)" },
      },
      required: ["drive_id", "file_id"],
    },
  },

  // Swiss Backup Tools
  {
    name: "infomaniak_list_swiss_backups",
    description: "List all Swiss Backup products for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_swiss_backup",
    description: "Get detailed information about a Swiss Backup product",
    inputSchema: {
      type: "object",
      properties: {
        backup_id: {
          type: "number",
          description: "The Swiss Backup product ID",
        },
      },
      required: ["backup_id"],
    },
  },
  {
    name: "infomaniak_list_swiss_backup_slots",
    description: "List all slots for a Swiss Backup product",
    inputSchema: {
      type: "object",
      properties: {
        backup_id: {
          type: "number",
          description: "The Swiss Backup product ID",
        },
      },
      required: ["backup_id"],
    },
  },

  // VPS Tools
  {
    name: "infomaniak_list_vps",
    description: "List all VPS instances",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_get_vps",
    description: "Get detailed information about a VPS",
    inputSchema: {
      type: "object",
      properties: {
        vps_id: {
          type: "number",
          description: "The VPS ID",
        },
      },
      required: ["vps_id"],
    },
  },
  {
    name: "infomaniak_reboot_vps",
    description: "Reboot a VPS",
    inputSchema: {
      type: "object",
      properties: {
        vps_id: {
          type: "number",
          description: "The VPS ID to reboot",
        },
      },
      required: ["vps_id"],
    },
  },
  {
    name: "infomaniak_shutdown_vps",
    description: "Shutdown a VPS",
    inputSchema: {
      type: "object",
      properties: {
        vps_id: {
          type: "number",
          description: "The VPS ID to shutdown",
        },
      },
      required: ["vps_id"],
    },
  },
  {
    name: "infomaniak_boot_vps",
    description: "Boot a VPS",
    inputSchema: {
      type: "object",
      properties: {
        vps_id: {
          type: "number",
          description: "The VPS ID to boot",
        },
      },
      required: ["vps_id"],
    },
  },

  // Dedicated Server Tools
  {
    name: "infomaniak_list_dedicated_servers",
    description: "List all dedicated servers",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "infomaniak_get_dedicated_server",
    description: "Get detailed information about a dedicated server",
    inputSchema: {
      type: "object",
      properties: {
        server_id: {
          type: "number",
          description: "The dedicated server ID",
        },
      },
      required: ["server_id"],
    },
  },
  {
    name: "infomaniak_reboot_dedicated_server",
    description: "Reboot a dedicated server",
    inputSchema: {
      type: "object",
      properties: {
        server_id: {
          type: "number",
          description: "The dedicated server ID to reboot",
        },
      },
      required: ["server_id"],
    },
  },

  // SSL Certificate Tools
  {
    name: "infomaniak_list_certificates",
    description: "List all SSL certificates for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_certificate",
    description: "Get detailed information about an SSL certificate",
    inputSchema: {
      type: "object",
      properties: {
        certificate_id: {
          type: "number",
          description: "The SSL certificate ID",
        },
      },
      required: ["certificate_id"],
    },
  },

  // Invoicing Tools
  {
    name: "infomaniak_list_invoices",
    description: "List all invoices for an account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
      },
      required: ["account_id"],
    },
  },
  {
    name: "infomaniak_get_invoice",
    description: "Get detailed information about an invoice",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "number",
          description: "The account ID",
        },
        invoice_id: {
          type: "number",
          description: "The invoice ID",
        },
      },
      required: ["account_id", "invoice_id"],
    },
  },

  // Generic API Call Tool
  {
    name: "infomaniak_api_call",
    description: "Make a custom API call to any Infomaniak API endpoint. Use this for advanced operations not covered by other tools.",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          description: "HTTP method",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        endpoint: {
          type: "string",
          description: "API endpoint path (e.g., /1/account or /2/drive/123)",
        },
        body: {
          type: "object",
          description: "Request body for POST/PUT/PATCH requests",
        },
        query_params: {
          type: "object",
          description: "Query parameters as key-value pairs",
        },
      },
      required: ["method", "endpoint"],
    },
  },

  // kDrive Extras
  {
    name: "infomaniak_list_kdrive_trash",
    description: "List files in the kDrive trash",
    inputSchema: { type: "object", properties: { drive_id: { type: "number", description: "The kDrive ID" } }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_restore_kdrive_file",
    description: "Restore a file from the kDrive trash, optionally into another directory",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" }, destination_directory_id: { type: "number", description: "Optional: directory to restore into" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_empty_kdrive_trash",
    description: "Permanently delete all files in the kDrive trash",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" } }, required: ["drive_id"] },
  },
  {
    name: "infomaniak_list_kdrive_file_versions",
    description: "List version history of a file in kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_get_kdrive_activity",
    description: "Get activity log for a kDrive or a specific file",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: { type: "number" },
        file_id: { type: "number", description: "Optional: filter by file" },
        lang: { type: "string", enum: [...KDRIVE_LANGS], description: "Language of the drive-wide activity feed (default en); ignored with file_id" },
      },
      required: ["drive_id"],
    },
  },
  {
    name: "infomaniak_add_kdrive_favorite",
    description: "Add a file or directory to kDrive favorites",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_remove_kdrive_favorite",
    description: "Remove a file or directory from kDrive favorites",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" }, file_id: { type: "number" } }, required: ["drive_id", "file_id"] },
  },
  {
    name: "infomaniak_download_kdrive_file",
    description: "Read a kDrive file's content. Text files (txt, md, csv, json, html, ...) are returned as text, truncated to max_chars. Other files up to 10 MB are returned as an image or embedded resource (base64), for example PDFs or Office documents.",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: { type: "number", description: "The kDrive ID" },
        file_id: { type: "number", description: "The file ID" },
        max_chars: { type: "number", description: `Maximum characters returned for text files (default ${DEFAULT_TEXT_CHARS}, max ${MAX_TEXT_CHARS})` },
      },
      required: ["drive_id", "file_id"],
    },
  },
  {
    name: "infomaniak_upload_kdrive_file",
    description: "Upload a file (max 10 MB) into a kDrive directory. Provide content_text for UTF-8 text or content_base64 for binary content.",
    inputSchema: {
      type: "object",
      properties: {
        drive_id: { type: "number", description: "The kDrive ID" },
        directory_id: { type: "number", description: "Destination directory ID (default: root, id 1)" },
        file_name: { type: "string", description: "Name of the new file, without path" },
        content_text: { type: "string", description: "UTF-8 text content" },
        content_base64: { type: "string", description: "Base64-encoded binary content" },
        conflict: { type: "string", enum: ["error", "rename", "version"], description: "If a file with that name exists: error, rename (keep both, default) or version (replace, keeping the old content as a version)" },
      },
      required: ["drive_id", "file_name"],
    },
  },
  {
    name: "infomaniak_list_kdrive_favorites",
    description: "List favorite files in a kDrive",
    inputSchema: { type: "object", properties: { drive_id: { type: "number" } }, required: ["drive_id"] },
  },

  // kChat Tools
  {
    name: "infomaniak_kchat_get_me",
    description: "Get the current kChat user profile",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "infomaniak_kchat_list_teams",
    description: "List all kChat teams",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "infomaniak_kchat_list_my_teams",
    description: "List kChat teams the current user belongs to",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "infomaniak_kchat_list_channels",
    description: "List all channels in a kChat team",
    inputSchema: { type: "object", properties: { team_id: { type: "string", description: "The team ID" } }, required: ["team_id"] },
  },
  {
    name: "infomaniak_kchat_list_my_channels",
    description: "List kChat channels the current user is a member of",
    inputSchema: { type: "object", properties: { team_id: { type: "string", description: "The team ID" } }, required: ["team_id"] },
  },
  {
    name: "infomaniak_kchat_get_channel",
    description: "Get details about a kChat channel",
    inputSchema: { type: "object", properties: { channel_id: { type: "string", description: "The channel ID" } }, required: ["channel_id"] },
  },
  {
    name: "infomaniak_kchat_get_channel_posts",
    description: "Get recent posts in a kChat channel",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        page: { type: "number", description: "Page number (0-indexed)" },
        per_page: { type: "number", description: "Posts per page (max 200)" },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "infomaniak_kchat_create_post",
    description: "Send a message to a kChat channel",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "The channel ID" },
        message: { type: "string", description: "Message text (supports Markdown)" },
        root_id: { type: "string", description: "Parent post ID for threading" },
      },
      required: ["channel_id", "message"],
    },
  },
  {
    name: "infomaniak_kchat_delete_post",
    description: "Delete a kChat post",
    inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"] },
  },
  {
    name: "infomaniak_kchat_search_posts",
    description: "Search posts in a kChat team",
    inputSchema: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        terms: { type: "string", description: "Search terms" },
        is_or_search: { type: "boolean", description: "Use OR logic between terms" },
      },
      required: ["team_id", "terms"],
    },
  },
  {
    name: "infomaniak_kchat_create_direct",
    description: "Create or get a direct message channel between two users",
    inputSchema: {
      type: "object",
      properties: { user_ids: { type: "array", items: { type: "string" }, description: "Exactly two user IDs" } },
      required: ["user_ids"],
    },
  },
  {
    name: "infomaniak_kchat_search_users",
    description: "Search kChat users by username or name",
    inputSchema: { type: "object", properties: { term: { type: "string", description: "Search term" } }, required: ["term"] },
  },
  {
    name: "infomaniak_kchat_list_users",
    description: "List kChat users, optionally filtered by team or channel",
    inputSchema: {
      type: "object",
      properties: {
        in_team_id: { type: "string", description: "Filter by team" },
        in_channel_id: { type: "string", description: "Filter by channel" },
      },
      required: [],
    },
  },
];

type Ctx = { client: InfomaniakClient };

const on = <S extends z.ZodTypeAny>(schema: S, run: (input: z.output<S>, ctx: Ctx) => Promise<unknown>) =>
  handler(schema, run);
const onKChat = <S extends z.ZodTypeAny>(schema: S, run: (input: z.output<S>, kchat: KChatClient) => Promise<unknown>) =>
  handler(schema, run);

/** Each Infomaniak API tool's input schema and what it does with the validated input. */
const apiHandlers: Record<string, ToolHandler<Ctx>> = {
  // Profile & Account
  infomaniak_ping: on(NoInputSchema, (_v, { client }) => client.ping()),
  infomaniak_get_profile: on(NoInputSchema, (_v, { client }) => client.getProfile()),
  infomaniak_list_accounts: on(NoInputSchema, (_v, { client }) => client.getAccounts()),
  infomaniak_get_account: on(AccountIdSchema, (v, { client }) => client.getAccount(v.account_id)),
  infomaniak_list_products: on(AccountIdSchema, (v, { client }) => client.getAccountProducts(v.account_id)),

  // Domains and DNS
  infomaniak_list_domains: on(AccountIdSchema, (v, { client }) => client.getDomains(v.account_id)),
  infomaniak_get_domain: on(GetDomainSchema, (v, { client }) => client.getDomain(v.account_id, v.domain)),
  infomaniak_get_domain_nameservers: on(GetDomainNameserversSchema, (v, { client }) => client.getDomainNameservers(v.domain)),
  infomaniak_update_domain_nameservers: on(UpdateDomainNameserversSchema, (v, { client }) =>
    client.updateDomainNameservers(v.domain, v.nameservers)),
  infomaniak_renew_domain: on(RenewDomainSchema, (v, { client }) => client.renewDomain(v.domain, v.duration)),
  infomaniak_list_dns_records: on(ListDnsRecordsSchema, (v, { client }) => client.getDnsRecords(v.domain)),
  infomaniak_create_dns_record: on(CreateDnsRecordSchema, ({ domain, ...record }, { client }) => client.createDnsRecord(domain, record)),
  infomaniak_update_dns_record: on(UpdateDnsRecordSchema, ({ domain, record_id, ...record }, { client }) =>
    client.updateDnsRecord(domain, record_id, record)),
  infomaniak_delete_dns_record: on(DeleteDnsRecordSchema, (v, { client }) => client.deleteDnsRecord(v.domain, v.record_id)),

  // Web Hosting
  infomaniak_list_web_hostings: on(AccountIdSchema, (v, { client }) => client.getWebHostings(v.account_id)),
  infomaniak_get_web_hosting: on(HostingIdSchema, (v, { client }) => client.getWebHosting(v.hosting_id)),
  infomaniak_list_sites: on(HostingIdSchema, (v, { client }) => client.getSites(v.hosting_id)),
  infomaniak_get_site: on(SiteIdSchema, (v, { client }) => client.getSite(v.hosting_id, v.site_id)),
  infomaniak_create_site: on(CreateSiteSchema, ({ hosting_id, ...site }, { client }) => client.createSite(hosting_id, site)),
  infomaniak_update_site: on(UpdateSiteSchema, ({ hosting_id, site_id, ...site }, { client }) => client.updateSite(hosting_id, site_id, site)),
  infomaniak_delete_site: on(DeleteSiteSchema, (v, { client }) => client.deleteSite(v.hosting_id, v.site_id)),

  // Databases
  infomaniak_list_databases: on(HostingIdSchema, (v, { client }) => client.getDatabases(v.hosting_id)),
  infomaniak_get_database: on(DatabaseIdSchema, (v, { client }) => client.getDatabase(v.hosting_id, v.database_id)),
  infomaniak_create_database: on(CreateDatabaseSchema, ({ hosting_id, ...database }, { client }) => client.createDatabase(hosting_id, database)),
  infomaniak_delete_database: on(DeleteDatabaseSchema, (v, { client }) => client.deleteDatabase(v.hosting_id, v.database_id)),

  // Cron jobs and FTP accounts
  infomaniak_list_cron_jobs: on(HostingIdSchema, (v, { client }) => client.getCronJobs(v.hosting_id)),
  infomaniak_create_cron_job: on(CreateCronJobSchema, ({ hosting_id, ...cron }, { client }) => client.createCronJob(hosting_id, cron)),
  infomaniak_update_cron_job: on(UpdateCronJobSchema, ({ hosting_id, cron_id, ...cron }, { client }) =>
    client.updateCronJob(hosting_id, cron_id, cron)),
  infomaniak_delete_cron_job: on(CronJobIdSchema, (v, { client }) => client.deleteCronJob(v.hosting_id, v.cron_id)),
  infomaniak_list_ftp_accounts: on(HostingIdSchema, (v, { client }) => client.getFtpAccounts(v.hosting_id)),
  infomaniak_create_ftp_account: on(CreateFtpAccountSchema, ({ hosting_id, ...ftp }, { client }) => client.createFtpAccount(hosting_id, ftp)),
  infomaniak_update_ftp_account: on(UpdateFtpAccountSchema, ({ hosting_id, ftp_id, ...ftp }, { client }) =>
    client.updateFtpAccount(hosting_id, ftp_id, ftp)),
  infomaniak_delete_ftp_account: on(FtpAccountIdSchema, (v, { client }) => client.deleteFtpAccount(v.hosting_id, v.ftp_id)),

  // kDrive
  infomaniak_list_kdrives: on(AccountIdSchema, (v, { client }) => client.getKDrives(v.account_id)),
  infomaniak_get_kdrive: on(DriveIdSchema, (v, { client }) => client.getKDrive(v.drive_id)),
  infomaniak_list_kdrive_files: on(ListKDriveFilesSchema, (v, { client }) =>
    client.listKDriveFiles(v.drive_id, v.parent_id, { cursor: v.cursor, limit: v.limit, type: v.type })),
  infomaniak_get_kdrive_file: on(KDriveFileIdSchema, (v, { client }) => client.getKDriveFile(v.drive_id, v.file_id)),
  infomaniak_search_kdrive_files: on(SearchKDriveFilesSchema, (v, { client }) =>
    client.searchKDriveFiles(v.drive_id, v.query, { directoryId: v.directory_id, depth: v.depth, limit: v.limit })),
  infomaniak_create_kdrive_directory: on(CreateKDriveDirectorySchema, (v, { client }) =>
    client.createKDriveDirectory(v.drive_id, { name: v.name, parent_id: v.parent_id })),
  infomaniak_move_kdrive_file: on(MoveOrCopyKDriveFileSchema, (v, { client }) =>
    client.moveKDriveFile(v.drive_id, v.file_id, v.destination_directory_id)),
  infomaniak_copy_kdrive_file: on(MoveOrCopyKDriveFileSchema, (v, { client }) =>
    client.copyKDriveFile(v.drive_id, v.file_id, v.destination_directory_id)),
  infomaniak_rename_kdrive_file: on(RenameKDriveFileSchema, (v, { client }) => client.renameKDriveFile(v.drive_id, v.file_id, v.name)),
  infomaniak_delete_kdrive_file: on(KDriveFileIdSchema, (v, { client }) => client.deleteKDriveFile(v.drive_id, v.file_id)),
  infomaniak_share_kdrive_file: on(ShareKDriveFileSchema, ({ drive_id, file_id, ...link }, { client }) =>
    client.shareKDriveFile(drive_id, file_id, link)),
  infomaniak_list_kdrive_trash: on(KDriveTrashSchema, (v, { client }) => client.listKDriveTrash(v.drive_id)),
  infomaniak_restore_kdrive_file: on(KDriveRestoreFileSchema, (v, { client }) =>
    client.restoreKDriveFile(v.drive_id, v.file_id, v.destination_directory_id)),
  infomaniak_empty_kdrive_trash: on(DriveIdSchema, (v, { client }) => client.emptyKDriveTrash(v.drive_id)),
  infomaniak_list_kdrive_file_versions: on(KDriveFileIdSchema, (v, { client }) => client.listKDriveFileVersions(v.drive_id, v.file_id)),
  infomaniak_get_kdrive_activity: on(KDriveActivitySchema, (v, { client }) => client.getKDriveActivity(v.drive_id, v.file_id, v.lang)),
  infomaniak_list_kdrive_favorites: on(KDriveFavoritesSchema, (v, { client }) => client.listKDriveFavorites(v.drive_id)),
  infomaniak_add_kdrive_favorite: on(KDriveFileIdSchema, (v, { client }) => client.addKDriveFavorite(v.drive_id, v.file_id)),
  infomaniak_remove_kdrive_favorite: on(KDriveFileIdSchema, (v, { client }) => client.removeKDriveFavorite(v.drive_id, v.file_id)),
  infomaniak_download_kdrive_file: on(DownloadKDriveFileSchema, async (v, { client }) => {
    const { data: file } = await client.getKDriveFile(v.drive_id, v.file_id);
    if (file.type === "dir") throw new Error(`${file.name} is a directory; use infomaniak_list_kdrive_files`);
    if (file.size > MAX_BINARY_BYTES) {
      throw new Error(`${file.name} is ${file.size} bytes; files over ${MAX_BINARY_BYTES} bytes cannot be returned`);
    }
    const download = await client.downloadKDriveFile(v.drive_id, v.file_id, MAX_BINARY_BYTES);
    const downloaded = {
      filename: file.name,
      mimeType: file.mime_type ?? download.contentType,
      bytes: download.bytes,
    };
    const metadata = { drive_id: v.drive_id, file_id: file.id };
    return new ToolContent(
      isTextLike(downloaded.mimeType, downloaded.filename)
        ? textFileToContent(downloaded, v.max_chars ?? DEFAULT_TEXT_CHARS, metadata)
        : binaryToContent(downloaded, `infomaniak-kdrive://${v.drive_id}/${file.id}`, metadata),
    );
  }),
  infomaniak_upload_kdrive_file: on(UploadKDriveFileSchema, async (v, { client }) => {
    const content = v.content_text !== undefined
      ? new TextEncoder().encode(v.content_text)
      : decodeBase64(v.content_base64 ?? "");
    if (content.byteLength > MAX_BINARY_BYTES) {
      throw new Error(`Upload is ${content.byteLength} bytes; the limit is ${MAX_BINARY_BYTES} bytes`);
    }
    return client.uploadKDriveFile(v.drive_id, {
      directoryId: v.directory_id ?? KDRIVE_ROOT_ID,
      fileName: v.file_name,
      content,
      conflict: v.conflict,
    });
  }),

  // Swiss Backup
  infomaniak_list_swiss_backups: on(AccountIdSchema, (v, { client }) => client.getSwissBackups(v.account_id)),
  infomaniak_get_swiss_backup: on(BackupIdSchema, (v, { client }) => client.getSwissBackup(v.backup_id)),
  infomaniak_list_swiss_backup_slots: on(BackupIdSchema, (v, { client }) => client.getSwissBackupSlots(v.backup_id)),

  // VPS and dedicated servers
  infomaniak_list_vps: on(NoInputSchema, (_v, { client }) => client.getVpsList()),
  infomaniak_get_vps: on(VpsIdSchema, (v, { client }) => client.getVps(v.vps_id)),
  infomaniak_reboot_vps: on(VpsIdSchema, (v, { client }) => client.rebootVps(v.vps_id)),
  infomaniak_shutdown_vps: on(VpsIdSchema, (v, { client }) => client.shutdownVps(v.vps_id)),
  infomaniak_boot_vps: on(VpsIdSchema, (v, { client }) => client.bootVps(v.vps_id)),
  infomaniak_list_dedicated_servers: on(NoInputSchema, (_v, { client }) => client.getDedicatedServers()),
  infomaniak_get_dedicated_server: on(ServerIdSchema, (v, { client }) => client.getDedicatedServer(v.server_id)),
  infomaniak_reboot_dedicated_server: on(ServerIdSchema, (v, { client }) => client.rebootDedicatedServer(v.server_id)),

  // SSL certificates and invoicing
  infomaniak_list_certificates: on(AccountIdSchema, (v, { client }) => client.getCertificates(v.account_id)),
  infomaniak_get_certificate: on(CertificateIdSchema, (v, { client }) => client.getCertificate(v.certificate_id)),
  infomaniak_list_invoices: on(AccountIdSchema, (v, { client }) => client.getInvoices(v.account_id)),
  infomaniak_get_invoice: on(InvoiceIdSchema, (v, { client }) => client.getInvoice(v.account_id, v.invoice_id)),

  // Generic API call
  infomaniak_api_call: on(ApiCallSchema, (v, { client }) => client.call(v.method, v.endpoint, v.body, v.query_params)),
};

/** Each kChat tool's input schema and what it does with the validated input. */
const kchatHandlers: Record<string, ToolHandler<KChatClient>> = {
  infomaniak_kchat_get_me: onKChat(NoInputSchema, (_v, kchat) => kchat.getMe()),
  infomaniak_kchat_list_teams: onKChat(NoInputSchema, (_v, kchat) => kchat.listTeams()),
  infomaniak_kchat_list_my_teams: onKChat(NoInputSchema, (_v, kchat) => kchat.listMyTeams()),
  infomaniak_kchat_list_channels: onKChat(KChatTeamIdSchema, (v, kchat) => kchat.listChannels(v.team_id)),
  infomaniak_kchat_list_my_channels: onKChat(KChatTeamIdSchema, (v, kchat) => kchat.listMyChannels(v.team_id)),
  infomaniak_kchat_get_channel: onKChat(KChatChannelIdSchema, (v, kchat) => kchat.getChannel(v.channel_id)),
  infomaniak_kchat_get_channel_posts: onKChat(KChatGetChannelPostsSchema, (v, kchat) =>
    kchat.getChannelPosts(v.channel_id, v.page, v.per_page)),
  infomaniak_kchat_create_post: onKChat(CreateKChatPostSchema, (v, kchat) => kchat.createPost(v.channel_id, v.message, v.root_id)),
  infomaniak_kchat_delete_post: onKChat(KChatPostIdSchema, (v, kchat) => kchat.deletePost(v.post_id)),
  infomaniak_kchat_search_posts: onKChat(SearchKChatPostsSchema, (v, kchat) => kchat.searchPosts(v.team_id, v.terms, v.is_or_search)),
  infomaniak_kchat_create_direct: onKChat(CreateKChatDirectChannelSchema, (v, kchat) =>
    kchat.createDirectChannel([v.user_ids[0], v.user_ids[1]])),
  infomaniak_kchat_search_users: onKChat(SearchKChatUsersSchema, (v, kchat) => kchat.searchUsers(v.term)),
  infomaniak_kchat_list_users: onKChat(ListKChatUsersSchema, (v, kchat) =>
    kchat.listUsers({ inTeamId: v.in_team_id, inChannelId: v.in_channel_id })),
};

/** The input schema of every tool this server has, by name. */
export const inputSchemas: ReadonlyMap<string, z.ZodTypeAny> = new Map(
  [mailHandlers, apiHandlers, kchatHandlers, imapHandlers].flatMap((group) =>
    Object.entries(group).map(([name, h]) => [name, h.schema] as [string, z.ZodTypeAny])),
);

/** A tool's definition with its input schema derived from the zod schema that validates it. */
function published(tool: Tool): Tool {
  const schema = inputSchemas.get(tool.name);
  if (!schema) throw new Error(`server: tool ${tool.name} has no handler`);
  return { ...tool, inputSchema: toInputSchema(schema, tool.inputSchema) };
}

/** Every tool as listed to clients, with its input schema derived from zod. Startup fails if one has no handler. */
export const tools: Tool[] = toolDefinitions.map(published);
/** The same, with hints and approval marker from the policy. Startup fails if one cannot be classified. */
export const annotatedTools: Tool[] = annotate(tools);
/** The IMAP tools as listed when IMAP is configured. */
export const annotatedImapTools: Tool[] = annotate(imapTools.map(published));

/** Runs an already-validated call. */
async function runTool(
  name: string,
  input: unknown,
  client: InfomaniakClient,
  kchatClient: KChatClient | null,
  imapReader: ImapReader | null,
): Promise<unknown> {
  if (mailHandlers[name]) return mailHandlers[name].run(input, client);
  if (apiHandlers[name]) return apiHandlers[name].run(input, { client });
  if (kchatHandlers[name]) {
    if (!kchatClient) throw new Error("kChat is not configured. Set KCHAT_HOST and KCHAT_TOKEN environment variables.");
    return kchatHandlers[name].run(input, kchatClient);
  }
  if (imapHandlers[name]) return imapHandlers[name].run(input, requireImapReader(imapReader));
  throw new Error(`Unknown tool: ${name}`);
}

/**
 * Create and configure an MCP server instance
 *
 * @param client - The Infomaniak API client to use for tool calls
 * @param kchatClient - Optional kChat API client
 * @param options - Read-only mode, IMAP reader, who asks for approval
 * @returns Configured MCP Server instance
 */
export interface ServerOptions {
  /** Only read-only tools are listed and callable (INFOMANIAK_READ_ONLY). */
  readOnly?: boolean;
  /** Reads the mailbox over IMAP; without it the mail-reading tools are not listed. */
  imapReader?: ImapReader | null;
  /** Who asks the person before a tool that needs approval (INFOMANIAK_CONFIRM); default: the server, by elicitation. */
  confirm?: ConfirmMode;
  /** How long the person has to answer (default CONFIRM_TIMEOUT_MS). */
  confirmTimeoutMs?: number;
}

export function createMcpServer(
  client: InfomaniakClient,
  kchatClient?: KChatClient | null,
  options: ServerOptions = {},
): Server {
  const readOnly = options.readOnly ?? false;
  const imapReader = options.imapReader ?? null;
  const confirm = options.confirm ?? "elicitation";
  const known = imapReader ? [...annotatedTools, ...annotatedImapTools] : annotatedTools;
  const offered = visibleTools(known, readOnly);
  const server = new Server(
    {
      name: "infomaniak-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: offered };
  });

  // Handle tool calls: the policy, then validation, then the person's approval, then the API.
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    try {
      assertAllowed(name, known, readOnly);
      const schema = inputSchemas.get(name);
      if (!schema) throw new Error(`Unknown tool: ${name}`);
      const input = validate(schema, args ?? {});

      const reason = confirmationReason(name);
      if (reason !== null && confirm === "elicitation") {
        await confirmWithPerson(server, { name, reason, input }, {
          relatedRequestId: extra.requestId,
          signal: extra.signal,
          timeoutMs: options.confirmTimeoutMs,
        });
      }

      const result = await runTool(name, input, client, kchatClient ?? null, imapReader);
      if (result instanceof ToolContent) return { content: result.content };

      const content: TextContent[] = [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ];

      return { content };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const prefix = error instanceof PolicyRefusal ? "Refused" : "Error";
      return {
        content: [
          {
            type: "text",
            text: `${prefix}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
