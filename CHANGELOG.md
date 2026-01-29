# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project attempts to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
## [${version}]

_For multi-package releases, list package versions here_

### Added - for new features
### Changed - for changes in existing functionality
### Deprecated - for soon-to-be removed features
### Removed - for now removed features
### Fixed - for any bug fixes
### Security - in case of vulnerabilities

For multi-package releases, use package names as subsections:
### package-name
#### Added/Changed/etc...

[${version}]: https://github.com/joshuadavidthomas/pi-opensync-plugin/releases/tag/${tag}
-->

## [Unreleased]

### Changed

- Changed model sync to send model name instead of model ID for better readability in OpenSync dashboards
- Changed provider sync to replace hyphens with spaces (e.g., `anthropic-bedrock` → `anthropic bedrock`)

## [0.1.0]

### Added

- Added pi extension that syncs sessions to OpenSync dashboards
- Added `/opensync:config` command for interactive configuration
- Added support for syncing tool calls, thinking/reasoning content, and structured message parts

### New Contributors

- Josh Thomas <josh@joshthomas.dev> (maintainer)

[unreleased]: https://github.com/joshuadavidthomas/pi-opensync-plugin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joshuadavidthomas/pi-opensync-plugin/releases/tag/v0.1.0
