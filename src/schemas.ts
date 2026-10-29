/**
 * Zod validation schemas for MCP tool inputs
 *
 * Every tool input is a strict object: a key the tool does not know is an
 * error, not silently dropped, so a mistyped option cannot turn into a call
 * that does something else than asked. Ids are positive integers, and every
 * string that ends up in a URL path is held to a shape that cannot leave its
 * path segment (the client also encodes it). Where a route is in Infomaniak's
 * published OpenAPI document, the constraints follow it; routes outside it
 * (see src/api-routes.contract.test.ts) get only those sanity checks.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KDRIVE_LANGS } from './infomaniak-client.js';

/** A tool's input: an object that refuses keys it does not declare. */
export const input = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

/** A positive integer id, as every Infomaniak id in a path is. */
export const id = (name: string) =>
  z.number({ required_error: `${name} is required`, invalid_type_error: `${name} must be a number` })
    .int(`${name} must be an integer`)
    .positive(`${name} must be positive`);

/**
 * A domain name: dot-separated labels of letters (IDN included), digits and
 * hyphens. No "/", "?", "#", "%" or "..", so it cannot reach another route
 * when it is put in a path.
 */
const DOMAIN_NAME = /^[\p{L}\p{M}\p{N}-]+(\.[\p{L}\p{M}\p{N}-]+)+$/u;
// A refinement rather than .regex(): a JSON Schema pattern has no `u` flag, so
// it could not carry the Unicode classes that let IDN labels through.
export const domainName = z
  .string({ required_error: 'domain is required' })
  .min(1, 'domain cannot be empty')
  .max(253, 'domain is at most 253 characters')
  .refine((name) => DOMAIN_NAME.test(name), 'domain must be a domain name such as example.com');

/**
 * False for "." and "..", the segments a URL parser resolves to the parent
 * route (any run of dots, to be safe), whatever encoding they get.
 */
export const notOnlyDots = (value: string): boolean => !/^\.+$/.test(value);

/** A kChat (Mattermost) id: letters and digits only. */
const kchatId = (name: string) =>
  z.string({ required_error: `${name} is required` })
    .min(1, `${name} cannot be empty`)
    .regex(/^[A-Za-z0-9]+$/, `${name} is a kChat id (letters and digits)`);

/** Unix time in seconds, as the API takes dates, up to 9999-12-31. */
const unixTime = z.number().int().min(0).max(253402300799);

/** Tools that take no input. */
export const NoInputSchema = input({});

// Common schemas
export const AccountIdSchema = input({
  account_id: id('account_id'),
});

export const DomainNameSchema = input({
  domain: domainName,
});

// DNS Record schemas
export const DnsRecordTypeSchema = z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA']);

export const ListDnsRecordsSchema = DomainNameSchema;

export const CreateDnsRecordSchema = input({
  domain: domainName,
  source: z.string({ required_error: 'source is required' }),
  type: DnsRecordTypeSchema,
  target: z.string({ required_error: 'target is required' }).min(1, 'target cannot be empty'),
  ttl: z.number().int().min(60).max(86400).optional(),
  priority: z.number().int().min(0).max(65535).optional(),
});

export const UpdateDnsRecordSchema = input({
  domain: domainName,
  record_id: id('record_id'),
  source: z.string().optional(),
  type: DnsRecordTypeSchema.optional(),
  target: z.string().min(1).optional(),
  ttl: z.number().int().min(60).max(86400).optional(),
  priority: z.number().int().min(0).max(65535).optional(),
});

export const DeleteDnsRecordSchema = input({
  domain: domainName,
  record_id: id('record_id'),
});

// Domain schemas
export const GetDomainSchema = input({
  account_id: id('account_id'),
  domain: domainName,
});

// Web Hosting schemas
export const HostingIdSchema = input({
  hosting_id: id('hosting_id'),
});

export const SiteIdSchema = input({
  hosting_id: id('hosting_id'),
  site_id: id('site_id'),
});

// The API expects `domain` and `directory`. `fqdn` and `path` are accepted as
// deprecated aliases for backward compatibility with earlier versions of this tool.
export const CreateSiteSchema = input({
  hosting_id: id('hosting_id'),
  domain: z.string().min(1, 'domain cannot be empty').optional(),
  directory: z.string().min(1, 'directory cannot be empty').optional(),
  fqdn: z.string().min(1, 'fqdn cannot be empty').optional(),
  path: z.string().min(1, 'path cannot be empty').optional(),
  php_version: z.string().optional(),
})
  .refine((site) => site.domain !== undefined || site.fqdn !== undefined, {
    message: 'domain is required',
    path: ['domain'],
  })
  .transform(({ hosting_id, domain, directory, fqdn, path, php_version }) => {
    const siteDomain = (domain ?? fqdn) as string;
    return {
      hosting_id,
      domain: siteDomain,
      directory: directory ?? path ?? `/sites/${siteDomain}`,
      php_version,
    };
  });

export const UpdateSiteSchema = input({
  hosting_id: id('hosting_id'),
  site_id: id('site_id'),
  path: z.string().optional(),
  php_version: z.string().optional(),
});

export const DeleteSiteSchema = SiteIdSchema;

// Database schemas
export const DatabaseIdSchema = input({
  hosting_id: id('hosting_id'),
  database_id: id('database_id'),
});

export const CreateDatabaseSchema = input({
  hosting_id: id('hosting_id'),
  name: z.string({ required_error: 'name is required' }).min(1, 'database name cannot be empty'),
  charset: z.string().optional(),
});

export const DeleteDatabaseSchema = DatabaseIdSchema;

// kDrive schemas
export const DriveIdSchema = input({
  drive_id: id('drive_id'),
});

// Swiss Backup schemas
export const BackupIdSchema = input({
  backup_id: id('backup_id'),
});

// VPS schemas
export const VpsIdSchema = input({
  vps_id: id('vps_id'),
});

// Dedicated Server schemas
export const ServerIdSchema = input({
  server_id: id('server_id'),
});

// Certificate schemas
export const CertificateIdSchema = input({
  certificate_id: id('certificate_id'),
});

// Invoice schemas
export const InvoiceIdSchema = input({
  account_id: id('account_id'),
  invoice_id: id('invoice_id'),
});

// Generic API call schema. The endpoint is a plain path: the query goes in
// query_params, and "." or ".." segments, written out or as %2e (which fetch
// would resolve to another route than the one shown), are refused.
export const ApiCallSchema = input({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  endpoint: z.string({ required_error: 'endpoint is required' })
    .startsWith('/', 'endpoint must start with /')
    .regex(/^\/[^?#\s\\]*$/, 'endpoint is a path without query, fragment, spaces or backslashes; put parameters in query_params')
    .refine(
      (path) => path.split('/').every((s) => notOnlyDots(s.replace(/%2e/gi, '.'))),
      'endpoint must not contain "." or ".." segments',
    ),
  body: z.record(z.unknown()).optional(),
  query_params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

// Domain extras
export const GetDomainNameserversSchema = DomainNameSchema;

export const UpdateDomainNameserversSchema = input({
  domain: domainName,
  nameservers: z.array(z.object({
    host: z.string().min(1),
    ip: z.string().optional(),
  }).strict()).min(1),
});

export const RenewDomainSchema = input({
  domain: domainName,
  duration: z.number().int().positive(),
});

// Cron jobs
export const CronJobIdSchema = input({
  hosting_id: id('hosting_id'),
  cron_id: id('cron_id'),
});

export const CreateCronJobSchema = input({
  hosting_id: id('hosting_id'),
  command: z.string({ required_error: 'command is required' }).min(1),
  schedule: z.string({ required_error: 'schedule is required' }).min(1),
  description: z.string().optional(),
});

export const UpdateCronJobSchema = input({
  hosting_id: id('hosting_id'),
  cron_id: id('cron_id'),
  command: z.string().optional(),
  schedule: z.string().optional(),
  description: z.string().optional(),
});

// FTP accounts
export const FtpAccountIdSchema = input({
  hosting_id: id('hosting_id'),
  ftp_id: id('ftp_id'),
});

export const CreateFtpAccountSchema = input({
  hosting_id: id('hosting_id'),
  login: z.string({ required_error: 'login is required' }).min(1),
  password: z.string({ required_error: 'password is required' }).min(8),
  home_directory: z.string().optional(),
});

export const UpdateFtpAccountSchema = input({
  hosting_id: id('hosting_id'),
  ftp_id: id('ftp_id'),
  password: z.string().min(8).optional(),
  home_directory: z.string().optional(),
  is_active: z.boolean().optional(),
});

// kDrive file ops (constraints from the published OpenAPI document)
export const KDriveFileIdSchema = input({
  drive_id: id('drive_id'),
  file_id: id('file_id'),
});

/** The kDrive listings take between 5 and 1000 entries per page. */
const kdriveLimit = z.number().int().min(5).max(1000);

export const ListKDriveFilesSchema = input({
  drive_id: id('drive_id'),
  parent_id: id('parent_id').optional(),
  cursor: z.string().min(1).optional(),
  limit: kdriveLimit.optional(),
  type: z.enum(['file', 'dir']).optional(),
});

export const SearchKDriveFilesSchema = input({
  drive_id: id('drive_id'),
  query: z.string({ required_error: 'query is required' }).min(1),
  directory_id: id('directory_id').optional(),
  depth: z.enum(['unlimited', 'child']).optional(),
  limit: kdriveLimit.optional(),
});

export const CreateKDriveDirectorySchema = input({
  drive_id: id('drive_id'),
  name: z.string({ required_error: 'name is required' }).min(1),
  parent_id: id('parent_id').optional(),
});

export const MoveOrCopyKDriveFileSchema = input({
  drive_id: id('drive_id'),
  file_id: id('file_id'),
  destination_directory_id: id('destination_directory_id'),
});

export const RenameKDriveFileSchema = input({
  drive_id: id('drive_id'),
  file_id: id('file_id'),
  name: z.string({ required_error: 'name is required' }).min(1),
});

// The link endpoint requires `right` (public or password) and takes
// `valid_until` as a Unix timestamp; a password link needs its password.
export const ShareKDriveFileSchema = input({
  drive_id: id('drive_id'),
  file_id: id('file_id'),
  right: z.enum(['public', 'password']).default('public'),
  password: z.string().min(1).optional(),
  valid_until: unixTime.optional(),
}).refine(
  (link) => (link.right === 'password') === (link.password !== undefined),
  { message: 'password is required with right "password", and only then', path: ['password'] },
);

// kDrive extras
export const KDriveTrashSchema = DriveIdSchema;

export const KDriveRestoreFileSchema = input({
  drive_id: id('drive_id'),
  file_id: id('file_id'),
  destination_directory_id: id('destination_directory_id').optional(),
});

export const KDriveActivitySchema = input({
  drive_id: id('drive_id'),
  file_id: id('file_id').optional(),
  lang: z.enum(KDRIVE_LANGS).optional(),
});

export const KDriveFavoritesSchema = DriveIdSchema;

export const DownloadKDriveFileSchema = input({
  drive_id: id('drive_id'),
  file_id: id('file_id'),
  max_chars: z.number().int().min(1).max(200_000).optional(),
});

export const UploadKDriveFileSchema = input({
  drive_id: id('drive_id'),
  directory_id: id('directory_id').optional(),
  file_name: z.string({ required_error: 'file_name is required' })
    .min(1)
    .max(255)
    .refine((name) => !name.includes('/'), 'file_name must not contain "/"'),
  content_text: z.string().optional(),
  content_base64: z.string().optional(),
  conflict: z.enum(['error', 'rename', 'version']).default('rename'),
}).refine(
  (v) => (v.content_text === undefined) !== (v.content_base64 === undefined),
  'Provide exactly one of content_text or content_base64',
);

// kChat schemas
export const KChatTeamIdSchema = input({
  team_id: kchatId('team_id'),
});

export const KChatChannelIdSchema = input({
  channel_id: kchatId('channel_id'),
});

export const KChatPostIdSchema = input({
  post_id: kchatId('post_id'),
});

export const CreateKChatPostSchema = input({
  channel_id: kchatId('channel_id'),
  message: z.string({ required_error: 'message is required' }).min(1),
  root_id: kchatId('root_id').optional(),
});

export const SearchKChatPostsSchema = input({
  team_id: kchatId('team_id'),
  terms: z.string({ required_error: 'terms is required' }).min(1),
  is_or_search: z.boolean().optional(),
});

// An array of exactly two, not a tuple: a tuple's JSON Schema (`items` as an
// array) is not valid in the JSON Schema 2020-12 that MCP clients expect.
export const CreateKChatDirectChannelSchema = input({
  user_ids: z.array(kchatId('user_ids[]')).length(2, 'user_ids holds exactly two user ids'),
});

export const SearchKChatUsersSchema = input({
  term: z.string({ required_error: 'term is required' }).min(1),
});

export const ListKChatUsersSchema = input({
  in_team_id: kchatId('in_team_id').optional(),
  in_channel_id: kchatId('in_channel_id').optional(),
});

export const KChatGetChannelPostsSchema = input({
  channel_id: kchatId('channel_id'),
  page: z.number().int().min(0).optional(),
  per_page: z.number().int().min(1).max(200).optional(),
});

// Helper function to validate and return typed result
export function validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation error: ${errors}`);
  }
  return result.data;
}

/**
 * The input schema a client sees: types, limits, enums and required keys come
 * from the zod schema that validates the call, so the two cannot disagree;
 * the descriptions come from the tool's definition.
 */
export function toInputSchema(schema: z.ZodTypeAny, defined: Tool['inputSchema']): Tool['inputSchema'] {
  const { $schema: _draft, ...json } = zodToJsonSchema(schema, { $refStrategy: 'none' }) as {
    $schema?: string;
    properties?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  const docs = (defined.properties ?? {}) as Record<string, { description?: unknown }>;
  const properties = Object.fromEntries(
    Object.entries(json.properties ?? {}).map(([key, property]) => {
      const description = docs[key]?.description;
      return [key, typeof description === 'string' && property.description === undefined ? { ...property, description } : property];
    }),
  );
  return { ...json, type: 'object', properties };
}

/** A tool's input schema, and what the tool does with the input once validated. */
export interface ToolHandler<Ctx> {
  schema: z.ZodTypeAny;
  run(input: z.output<z.ZodTypeAny>, ctx: Ctx): Promise<unknown>;
}

/** Pairs a schema with its handler, which then receives the validated, typed input. */
export function handler<Ctx, S extends z.ZodTypeAny>(
  schema: S,
  run: (input: z.output<S>, ctx: Ctx) => Promise<unknown>,
): ToolHandler<Ctx> {
  return { schema, run };
}
