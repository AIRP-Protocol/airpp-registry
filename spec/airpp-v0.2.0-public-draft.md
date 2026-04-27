# AIRPP v0.2.0 Public Draft — Frozen for Implementation Testing

**Protocol:** AI Report Provenance Protocol  
**Short name:** AIRPP  
**Version:** 0.2.0  
**Status:** frozen_public_draft  
**Purpose:** implementation testing and interoperability feedback

## Mission

AIRPP provides a vendor-neutral provenance layer for AI-assisted reports, documents, code outputs and structured written work. It records how an output was produced, what sources informed it, which AI systems contributed, who reviewed it, and whether the final artefact can be audited later.

## Core artefacts

AIRPP defines three formal artefacts:

1. **Event Log** — append-only event trail.
2. **Manifest** — structured provenance record.
3. **Attestation** — verifiable statement binding a manifest to an artefact, export, commit or package.

## Conformance levels

- `basic`
- `auditable`
- `high_assurance`

## Binding modes

- Detached manifest
- Embedded manifest
- API transport
- ZIP/export bundle
- Registry reference

## MCP binding

AIRPP may be bound to MCP by exposing provenance tools that record meaningful resource access, prompt use, generation events, review events, commit binding and manifest finalisation.

## Non-goals

AIRPP is not an AI detector, truth certifier, vendor lock-in mechanism, or substitute for professional judgement.
