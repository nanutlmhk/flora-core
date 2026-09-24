# Access and secret-transfer checklist

Use this checklist to transfer control without placing secrets or patient information in Git, email attachments, meeting notes, or the general handover archive.

## Repository access

- [ ] ESM supplies the GitHub organization and named user accounts.
- [ ] Access is granted to named accounts, not shared credentials.
- [ ] ESM verifies clone, branch, tag, issue, and release access.
- [ ] Repository ownership or mirroring method is recorded in the delivery register.
- [ ] Former access is reviewed and revoked when no longer required.

## Secrets that require a separate secure channel

- PostgreSQL administrator, application, view, and sync passwords
- Canopy session secret
- Leaf service secret
- Leaf-to-Canopy shared secret
- HIS gateway credentials or client certificates
- Device gateway credentials or certificates
- Signing certificates and private keys
- Production deployment credentials
- Demo/test accounts not intended for publication

The repository contains only placeholders in `.env.example`. Do not replace those placeholders with real values in Git.

## Required record for each secret

Record metadata, not the secret itself:

| Field | Required value |
| --- | --- |
| Secret identifier | Human-readable name |
| Owning system | Leaf, Canopy, PostgreSQL, HIS, device, signing, or deployment |
| Sender and recipient | Named individuals |
| Secure channel | Approved password manager or encrypted transfer mechanism |
| Date transferred | Timestamp |
| Rotation owner | Named role/person |
| Rotation completed | Timestamp or pending |
| Verification | Recipient confirmed successful use |

## Clinical and customer data

- [ ] Use synthetic data for build, automated tests, and demonstrations whenever possible.
- [ ] Do not include production database dumps in the normal source handover.
- [ ] If a clinical-data extract is essential, ESM/customer must approve the purpose, minimum fields, encryption, recipients, retention, and destruction method.
- [ ] Store backup hashes and evidence separately from encryption keys.
- [ ] Remove temporary restore databases and local copies after the agreed verification period.

## Completion record

| Area | ESM owner | Flora owner | Date verified | Notes |
| --- | --- | --- | --- | --- |
| Git repository |  |  |  |  |
| Documentation workspace |  |  |  |  |
| Development environment |  |  |  |  |
| Production/deployment environment |  |  |  |  |
| Database administration |  |  |  |  |
| HIS integration |  |  |  |  |
| Device integration |  |  |  |  |
| Signing/release credentials |  |  |  |  |
