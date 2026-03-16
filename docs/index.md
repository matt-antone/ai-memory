# AI-Memory Docs

This directory is the home for repository documentation and is ready to be used as the source for GitHub Pages.

## Start here

Use this docs site as the entry point when browsing a published GitHub Pages version of the repository.

- [Add AI-Memory to an Agent](ADDING_TO_AN_AGENT.md)
- [First Deploy Checklist](DEPLOYMENT.md)
- [Release Process](RELEASE.md)

## Overview

AI-Memory is a provider-agnostic memory and recall service built around a Supabase backend and an MCP-compatible edge surface.

It includes:

- explicit memory writes, search, linking, document ingestion, and summary promotion
- an in-memory adapter for local tests
- a Supabase REST and RPC adapter for persistence
- SQL migrations plus an MCP-compatible Supabase Edge Function

## GitHub Pages

These docs can live in the repository and be published with GitHub Pages from the `docs/` folder.

Typical setup:

1. Open the repository settings on GitHub.
2. Go to Pages.
3. Set the source to deploy from the main branch and `/docs`.
4. Use this file as the landing page.

If you want a custom domain, theme, or automated Pages workflow later, this structure is ready for that too.
