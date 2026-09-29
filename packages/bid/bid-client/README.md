---
description: "Browse central bid projects, reopen their Sessions, and read durable tender, match, section, and export results as conversation cards."
kind: "package-reference"
---
# @deepseek-ai/dsh-bid-client

English | [中文](README.zh.md)

## Summary

Browse central bid projects from a global panel, reopen each linked Session, and read durable bid results as conversation cards. Choose this package only in bid-specific Web compositions. The browser reaches the central Python service through the Host Remote, never directly.

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

The shipped `bid-web` profile mounts this package with its Host and browser dependencies.

### When to choose it

Choose it for bid-specific Web applications that need cross-Session project navigation and durable result cards. Omit it from generic Web compositions.

### Minimal configuration

Mount `@deepseek-ai/dsh-bid-client` after `@deepseek-ai/dsh-bid` and the Typert services. The package has no configuration fields. The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for accepted fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host exposes central project summaries through the generated `bidProjects` Remote namespace. The browser registers one global panel, one sidebar entry, and replayable conversation cards; every registration unloads with its owning Cordis fiber.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Bid product requirements](../PRODUCT.md)
- [Configuration catalog](../../../docs/config-catalog.md)
- [Cordis primer](../../../docs/cordis-primer.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only renders central project and durable Session state and contributes no model-visible input.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The current panel uses request-based project discovery.

- The project list refreshes when the global panel mounts; live central-project updates require a pushed Remote feed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
