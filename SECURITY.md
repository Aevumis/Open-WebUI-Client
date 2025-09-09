# Security Policy

## Supported Versions

We maintain the latest released version. Security fixes are prioritized for the current release.

## Reporting a Vulnerability

Please do not file public issues for security reports.

- Use GitHub "Security advisories" to privately disclose a vulnerability to maintainers, or
- Email: tech@aevumis.com

Please include:

- Affected version(s)
- Reproduction steps
- Impact assessment
- Suggested fixes (if available)

We aim to acknowledge within 72 hours and provide a remediation plan as soon as possible.

## Dependencies

This project uses third‑party open-source dependencies. If the vulnerability is in a dependency, we will coordinate an update and release.

## Keys & Secrets

- Do not commit API keys, keystores, or credentials to the repository.
- CI uses encrypted secrets for release builds. See `.github/workflows/release.yml`.

## Responsible Disclosure

We appreciate responsible disclosure and will credit reporters in the release notes upon request.
