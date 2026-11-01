# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Bun, React, and Tailwind CSS, using Bun's built-in APIs where practical and keeping third-party dependencies minimal. Published as a Docker image to GitHub Container Registry.

## Users

Developers working on Twir and other Twitch integrations who need to simulate Twitch behavior locally or in a development environment.

## Product Purpose

Provide a maintainable standalone Twitch mock compatible with the existing TwitchMock in the Twir monorepo, with a web interface for operating simulated channels, events, and chat.

## Operating Context

The mock exposes OAuth, Helix, EventSub WebSocket, chat, and administrative operations. The interface is used alongside a Twitch-integrated application to configure state and trigger events.

## Capabilities and Constraints

Preserve the behavior and integration contracts of the existing mock at `apps/twitch-mock` in the Twir monorepo. Store state in memory by default and optionally persist it with Bun's built-in SQLite. The application must be containerized and its image publishable with GitHub Actions.

## Brand Commitments

TwitchMock is the name of the existing developer tool.

## Evidence on Hand

The existing TwitchMock implementation and its tests in the Twir monorepo document its capabilities and behavior.

## Product Principles

- Keep the behavior of the Twitch interfaces and the administrative controls consistent.
- Make common simulation actions quick and observable.
- Make local setup and maintenance straightforward.
- Keep external dependencies to a minimum.
