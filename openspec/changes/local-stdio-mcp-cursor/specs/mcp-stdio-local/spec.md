## ADDED Requirements

### Requirement: Local stdio MCP process

The system SHALL provide a runnable process that implements the Model Context Protocol over **stdio** (stdin/stdout) for use by MCP clients that spawn a subprocess (e.g. Cursor).

#### Scenario: Process starts and accepts MCP session

- **WHEN** the host launches the stdio MCP entrypoint with required environment variables set
- **THEN** the process SHALL initialize without exiting and SHALL communicate using MCP over stdio until the host closes the connection

### Requirement: Tool parity with edge MCP

The stdio server SHALL register the same logical MCP tools as the Supabase edge `memory-mcp` function for memory operations (including at minimum: write, search, get, link, list_recent, ingest_document, promote_summary, and archive if exposed on edge), with equivalent input validation and error shaping compatible with MCP tool results.

#### Scenario: Tool list matches contract

- **WHEN** a client sends a tools/list (or equivalent discovery) request over the stdio session
- **THEN** the response SHALL include each memory tool defined for the edge deployment for this repository version, with names and schemas suitable for agent use

### Requirement: Backend connectivity via existing store

The stdio server SHALL persist and retrieve data through the same storage abstraction used in production (Supabase REST / `SupabaseRestStore` or documented equivalent), using configuration from environment variables; it SHALL NOT require the HTTP MCP edge endpoint for normal operation.

#### Scenario: Successful write uses Supabase

- **WHEN** a client invokes `memory.write` with valid arguments and valid Supabase credentials in the environment
- **THEN** the item SHALL be created in the configured backend and the tool result SHALL indicate success

### Requirement: Authentication and namespace behavior

The stdio server SHALL enforce the same authentication and namespace rules as the edge MCP server for a given request (e.g. access key / client identity headers mapped from env), so scoped credentials behave consistently across transports.

#### Scenario: Reject unauthorized request

- **WHEN** a tool call is made without valid credentials per runtime policy
- **THEN** the server SHALL return an MCP tool error result (not crash the process) with a stable error category consistent with existing runtime error normalization

### Requirement: Cursor install integration

The `ai-memory` CLI SHALL support installing Cursor MCP configuration that references the stdio entrypoint (command, args, env), and SHALL document required environment variables for that layout.

#### Scenario: Install produces stdio config

- **WHEN** the user runs the documented install path for Cursor with stdio transport selected (or default)
- **THEN** the generated `mcp.json` (or project-scoped equivalent) SHALL contain a stdio server entry pointing at the shipped entrypoint and SHALL reference secrets via environment placeholders appropriate for Cursor

### Requirement: Documentation

Project documentation SHALL explain when to use **stdio (Cursor)** versus **HTTP (remote / other hosts)**, and SHALL list required env vars and troubleshooting (e.g. full app restart if tools disappear).

#### Scenario: Operator can choose transport

- **WHEN** a reader follows the README or install docs
- **THEN** they SHALL find explicit guidance for Cursor stdio setup and for HTTP edge setup without contradiction
