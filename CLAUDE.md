# CLAUDE.md - Infomaniak MCP Server

This file provides guidance to Claude Code when working with this codebase.

## Project Overview

This is an MCP (Model Context Protocol) server that provides tools for interacting with the Infomaniak API. It allows AI assistants to manage Infomaniak services including domains, DNS, email, web hosting, kDrive, Swiss Backup, VPS, dedicated servers, SSL certificates, and invoicing.

## Tech Stack

- **Language**: TypeScript (ES2022)
- **Module System**: Node16 ESM
- **Runtime**: Node.js >= 18
- **Key Dependencies**:
  - `@modelcontextprotocol/sdk` - MCP server SDK
  - `zod` - Schema validation
- **Build Output**: `./build/`

## Project Structure

```
src/
├── index.ts              # Entry point: reads the environment, picks the transport
├── server.ts             # MCP server factory, tool definitions and handler maps
├── policy.ts             # Annotations, read-only mode, which tools need approval
├── confirm.ts            # Asking the person (MCP elicitation) before those tools run
├── infomaniak-client.ts  # Infomaniak API client with typed methods
├── kchat-client.ts       # kChat (Mattermost-compatible) client, optional
├── mail-tools.ts         # Mail hosting tools: definitions, schemas, handlers
├── imap-tools.ts         # Reading mail over IMAP, read-only, optional
├── schemas.ts            # Zod schemas for tool inputs, validate(), toInputSchema()
└── transports/
    ├── stdio.ts          # Default transport (Claude Desktop, Claude Code)
    └── http.ts           # Streamable HTTP transport (Express)
```

## Build and Run Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to build/
npm run dev          # Watch mode for development
npm start            # Run the built server
npm test             # Run unit tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run typecheck    # Type check without emitting
npm run inspector    # Test with MCP Inspector (requires INFOMANIAK_API_TOKEN env var)
```

## Architecture

### MCP Server (`src/server.ts`)
- Defines 104 tools organized by service category (domains, mail, hosting, kDrive, kChat, etc.), plus 3 optional IMAP tools in `src/imap-tools.ts`
- Transport-agnostic: `src/transports/stdio.ts` (default) or `src/transports/http.ts`
- Requires `INFOMANIAK_API_TOKEN` environment variable
- Each tool maps to one or more `InfomaniakClient` methods
- A call goes: read-only policy → `validate()` once against the tool's zod schema → approval (`confirm.ts`) when `confirmationReason()` says so → the handler, which receives the typed, validated input
- The `inputSchema` clients see is derived from the zod schema (`toInputSchema`); the literal in `toolDefinitions` carries the descriptions, and `src/tool-schemas.test.ts` holds it to the zod schema

### Safety (`src/policy.ts`, `src/confirm.ts`)
- Hints by verb; `destructiveHint` is true for anything not purely additive (update/move/rename too)
- 35 tools need approval on every call: the destructive ones, the `SENSITIVE` additive ones (money, DNS, cron, FTP, share links, forwarding, kChat posts) and `infomaniak_api_call`. The exact list is pinned in `src/tool-schemas.test.ts`
- They carry `_meta["anthropic/requiresUserInteraction"]` (Claude Code prompts even in auto mode) and, with `INFOMANIAK_CONFIRM=elicitation` (default), the server asks through elicitation and refuses on anything but an explicit yes

### API Client (`src/infomaniak-client.ts`)
- Base URL: `https://api.infomaniak.com`
- Authentication: OAuth 2.0 Bearer Token
- Rate Limit: 60 requests/minute
- Typed interfaces for all API responses

### Validation (`src/schemas.ts`)
- Zod schemas for all tool inputs
- `validate()` helper function for runtime validation
- Provides clear error messages with field paths

### Tests (`src/*.test.ts`)
- Unit tests for `InfomaniakClient` with mocked fetch
- Validation schema tests for all input types
- Uses Vitest framework

## Tool Categories

1. **Profile & Account**: ping, profile, accounts, products
2. **Domains**: list domains, get domain details
3. **DNS**: full CRUD for DNS records (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA)
4. **Mail Services**: mail hostings, mailboxes (by name), aliases, forwarding, redirections, auto-replies, folders — `src/mail-tools.ts`
5. **Web Hosting**: sites, PHP versions, databases
6. **kDrive**: drives, files (list with cursor paging, search, download, upload, move, copy, rename, share), trash, versions, activity, favorites
7. **Swiss Backup**: backup products and slots
8. **VPS**: list, get, reboot, shutdown, boot
9. **Dedicated Servers**: list, get, reboot
10. **SSL Certificates**: list and get certificates
11. **Invoicing**: list and get invoices
12. **Generic API**: custom API calls for advanced operations

## Development Guidelines

### Adding a New Tool

1. Add the tool definition to `toolDefinitions` in `src/server.ts` with:
   - `name`: Prefixed with `infomaniak_`, starting with a verb `src/policy.ts` knows (startup fails otherwise)
   - `description`: Clear description of what it does
   - `inputSchema`: the parameters with their descriptions (its structure must match the zod schema)

2. Add its zod schema in `src/schemas.ts` with `input({...})` (strict), `id()` for ids and `domainName` for domains

3. Add the handler to `apiHandlers` (or `kchatHandlers`) as `on(Schema, (v, { client }) => ...)`: it receives the validated input

4. If needed, add the method to `InfomaniakClient`, wrapping every string that goes into a path in `seg()`

5. Decide whether it needs approval: destructive verbs ask by default; an additive tool that reaches outside the account goes in `SENSITIVE`. Update the pinned lists in `src/tool-schemas.test.ts`

### API Endpoint Patterns

- API version is in the path: `/1/` (v1), `/2/` or `/3/` (kDrive mixes both: listings, search, details, moves and copies are on `/3/drive/...`)
- Account-scoped endpoints: `/1/account/{account_id}/...`
- Mail: `/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/...` (mailboxes are addressed by name); hostings listed with `/1/products?service_name=email_hosting`
- Other services: `/1/domain/`, `/1/web/`, etc. (not all are in the published OpenAPI document — see `src/api-routes.contract.test.ts`)

### Type Safety

- All API responses use the `ApiResponse<T>` wrapper type
- Create specific interfaces for response data types
- Use `unknown` for endpoints where response structure isn't fully typed

## Testing

Use the MCP Inspector for testing:

```bash
INFOMANIAK_API_TOKEN=your-token npm run inspector
```

## Common Issues

- **401 errors**: Invalid or expired API token
- **403 errors**: Token missing required scope
- **429 errors**: Rate limit exceeded (60 req/min)
- Build errors: Ensure `npm install` was run and TypeScript is installed
