---
description: "The bid group map: tender-to-award bidding as a stable seam over a central REST service, with the ctx.bid domain, model tools, and a human command, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/bid

English | [中文](README.zh.md)

## Summary

The bid group integrates tender-to-award bidding into the Harness as a stable seam over a central REST service. The `bid` domain owns the `ctx.bid` HTTP client and the durable `bid/*` Session events and projections; `tool-bid` exposes the four model-facing tools, `command-bid` the human `/bid` command, and `bid-guard` denies the tender-scoped tools until their tender is parsed. Heavy parsing, capability matching, section generation, and export run in the central service, so the Harness surface stays stable as the backend changes. Each session's bidding state belongs to the one agent that created it.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`bid`](bid/README.md) | The `ctx.bid` HTTP client seam, plus the `bid/*` event and projection declarations | `ctx.bid` |
| [`bid-guard`](bid-guard/README.md) | Pre-execute workflow gate: denies the tender-scoped tools until their tender is parsed | listens on `ctx.tools` |
| [`tool-bid`](tool-bid/README.md) | Model tools `bid_parse_tender`, `bid_match_capabilities`, `bid_generate_section`, `bid_export` | registers on `ctx.tools` |
| [`command-bid`](command-bid/README.md) | Human `/bid` command in UI command planes | registers on `ctx.commands` |
| [`bid-client`](bid-client/README.md) | Host-mediated project list and Web right-sidebar tab | mounts Host and Client faces |
| [`bid-web-profile`](bid-web-profile/README.md) | Shipped `bid-web` profile layer over base and Web | — (patch only) |

-----

<a id="related-documentation"></a>
## Related documentation

- [Bidding subsystem](../../docs/subsystems/bid.md) — the `ctx.bid` seam, the `bid/*` events, and the generated service API.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-bid) — the four bid-tool schemas the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-bid) — every accepted config field of the bid service.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
