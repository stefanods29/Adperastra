# ADR 0002: React for the UI

Status: proposed (Step 00, awaiting owner approval).

## Decision

React + Vite + strict TypeScript; tokens to CSS variables; lazy bundle per handler; virtualized lists.

## Why

React Aria/Radix accessibility, TanStack Virtual/Table, CodeMirror/PDF.js/Fabric/Konva wrappers, Storybook/Playwright ecosystem, step files assume it.

## Rejected

Svelte, Solid (thinner editor/a11y ecosystems).

## Consequences

Bundle discipline is a speed requirement (plan/speed.md); framework-specific code stays in src/, handlers behind registry.
