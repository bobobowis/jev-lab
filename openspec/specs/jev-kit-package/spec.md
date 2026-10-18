# jev-kit-package Specification

## Purpose

Packages the reusable Jev layer (client, question builders, policy helpers, file reads, guards, compaction advice, tools, hooks, event channel, ledger) as one standalone package that the lab, the hyper-jev skill, and other projects use, so there is one implementation of each Jev utility.

## Requirements

### Requirement: One standalone package
The reusable Jev layer SHALL live in a single package named `@bobobowis/jev-kit` with its own manifest, README, and tests. The package SHALL NOT import from the lab, the sandbox, or the skill, and SHALL have no runtime dependencies beyond Node's built-in modules.

#### Scenario: Package tests alone
- **WHEN** the package's own test suite runs with the lab directory removed
- **THEN** it passes on the mock backend

#### Scenario: No runtime dependencies
- **WHEN** the package's manifest is inspected
- **THEN** it lists no `dependencies` and no `peerDependencies`

### Requirement: Public API by entry point
The package SHALL export its API through declared entry points (at least the root for the client, types, and question builders, and named entry points for policy, files, guards, compaction, tools, hooks, events, and ledger), each with type declarations. Files that are not exported SHALL NOT be importable by consumers.

#### Scenario: Typed import from a consumer
- **WHEN** a TypeScript project imports `noul` and the client from `@bobobowis/jev-kit` and the bash gate from its guards entry point
- **THEN** the imports resolve with types and no deep path into the package is needed

#### Scenario: Private module
- **WHEN** a consumer imports a package file that no entry point exports
- **THEN** resolution fails

### Requirement: Publishable without publishing
The package SHALL produce an installable tarball containing only built JavaScript, type declarations, README, and license, and that tarball SHALL install into an empty project and run `jev --help` with no network access beyond the install itself. Publishing the package to a registry is not required.

#### Scenario: Install from the tarball
- **WHEN** the packed tarball is installed into an empty temporary project on Windows, macOS, or Linux
- **THEN** `pnpm exec jev --help` prints the subcommands and `jev gate --mock` runs

### Requirement: The lab uses the package
The lab SHALL import every Jev utility it shares with the package from the package, not from a copy. Existing lab import paths for the core and shared level helpers SHALL keep working, and the lab's offline tests SHALL pass unchanged.

#### Scenario: One client implementation
- **WHEN** the lab's `src/core/client.ts` is inspected
- **THEN** it re-exports the package's client and contains no client logic of its own

#### Scenario: Lab tests after the move
- **WHEN** the offline test suite runs after the core and helpers move into the package
- **THEN** every test that passed before passes

### Requirement: Skill starter stays self-contained and in step
The hyper-jev skill's starter SHALL keep a copy of the core that runs without the package installed. That copy SHALL be generated from the package, and a test SHALL fail when the copy and the package's core differ.

#### Scenario: Drift is caught
- **WHEN** the package's client changes and the skill copy is not regenerated
- **THEN** the drift test fails and names the file that differs

#### Scenario: Skill used offline
- **WHEN** the starter is copied out of the skill into a new directory with no access to the package
- **THEN** its tests pass on the mock backend

### Requirement: No silent mock in production
The package's client SHALL use the mock backend only when it is selected explicitly or under the test runner. Missing credentials SHALL cause an error, not a mock answer, and no command or API SHALL print a key.

#### Scenario: No key outside tests
- **WHEN** a `jev` command runs with no Jev key set and no `--mock`
- **THEN** it exits with an error naming the expected environment variables and makes no decision
