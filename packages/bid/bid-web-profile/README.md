---
description: "The shipped bidding Web profile layer, adding the bid service, tools, command, workflow guard, and project sidebar over the standard base and Web bundles."
kind: "package-bundle"
---

# @deepseek-ai/dsh-bid-web-profile

English | [中文](README.zh.md)

## Summary

Select `dsh --profile bid-web` to add the bidding workflow to the standard Web application. The shipped profile layers this bundle after `dsh-base` and `dsh-web-app`; it mounts the central-service client, model tools, `/bid` command, workflow guard, and Web project sidebar. Deployment settings come from environment variables, and the token itself stays outside configuration. The bundle relies on the jobs, subagent, and filesystem services already supplied by `dsh-base`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Start the shipped composition with:

```text
pnpm dsh --profile bid-web
```

The launcher auto-initializes the profile with `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and this bundle in that order. `BID_API_BASE_URL` is required. `BID_TOKEN_ENV` names the environment variable containing the delegation token; it defaults to `BID_DELEGATION_TOKEN` and never reads the token into the patch document.

| Environment variable | Default | Configuration target |
|---|---:|---|
| `BID_API_BASE_URL` | required | central API base URL |
| `BID_TOKEN_ENV` | `BID_DELEGATION_TOKEN` | static token environment-variable name |
| `BID_SERVICE_TOKEN_ENV` | none | service token env var for dynamic exchange |
| `BID_DELEGATION_SUBJECT` | none | WorkFusion subject username for dynamic exchange |
| `BID_MAX_TENDER_BYTES` | `104857600` | maximum tender bytes |
| `BID_MAX_EXPORT_BYTES` | `104857600` | maximum export bytes |
| `BID_TIMEOUT_MS` | `1800000` | central API request timeout |
| `BID_READ_CHUNK_BYTES` | `1048576` | tender file read size |
| `BID_SUBAGENT_PROVIDER` | `spawn` | section-preparation subagent provider |
| `BID_MAX_CONCURRENT_SECTIONS` | `4` | concurrent section workers |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch inserts five domain rows after the base and Web layers: `bid`, `tool-bid`, `command-bid`, `bid-guard`, and `bid-client`. It does not duplicate jobs, subagent, or filesystem packages because the base layer already provides those services and tools. Later profile, home, and `--patch` layers may replace any row by id.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Exact domain rows and environment expressions |
| [`src/index.ts`](src/index.ts) | Empty module entry required by the package format |
| [`tests/profile.spec.ts`](tests/profile.spec.ts) | Exact package, row, and Loader-expression composition checks |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Bid package group](../README.md) — owners of each mounted domain behavior.
- [app-boot profiles](../../boot/app-boot/README.md#profiles) — profile initialization and layer order.
- [Base bundle](../../bundle/base/README.md) — shared jobs, subagent, and filesystem composition.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `tool-bid`, which owns the model-facing schemas and results selected by this bundle.

#### KV Cache effect

The mounted bid tool schemas join the tool prefix. Changing the bundle or its tool rows changes that prefix for subsequent requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The profile requires a reachable central bid API and a token in the environment variable selected by `BID_TOKEN_ENV`.
- Numeric environment values are converted with JavaScript `Number`; the owning plugins reject invalid bounds when they load.
- This Web profile is the shipped bid surface; no bid-specific headless profile is provided.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
