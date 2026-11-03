# First four sources: publication permission review

Reviewed November 2, 2026. Scope: Pinpoint, Breezy HR, Manatal, and Trakstar
Hire/Recruiterbox. Existing TEST evidence demonstrates fetching and normalization;
it does not establish permission to republish unrelated employers' full job text.
Reviewed `docs/source-expansion-tracker.json`, `docs/source-expansion-progress.md`,
the implemented adapters/loaders, and the primary documents linked below. No
provider contact, account registration, purchase, application submission, or
production change occurred.

| Platform | Documented permitted integration | Publication decision for current ApplySmooth collector |
| --- | --- | --- |
| Pinpoint | Public job feeds explicitly support displaying an employer's jobs on another website. | Conditional: strongest public-feed evidence, but employer content authority and applicability of vendor requirements remain unconfirmed. |
| Breezy HR | Company-admin configured embed widget; account API; provider-integrated distribution. | Hold: no located public publisher grant for `/json` plus HTML detail extraction; supported-interface restriction needs resolution. |
| Manatal | Documented career-page API and own-company website integration. | Hold: independent aggregation rights and automated-request consent/exception remain unresolved under explicit terms. |
| Trakstar Hire | Documented public frontend openings API; customer-authorized integrations. | Conditional: API access is supported, but independent publication rights and current HTML date extraction need resolution. |

No source is cleared here for unrestricted cross-employer redistribution. This is
an evidence finding, not a claim that every documented customer integration is
prohibited. No blanket attribution-for-permission license was found for these four.

## Pinpoint

The [Job Feeds Overview](https://developers.pinpointhq.com/docs/job-feeds-overview)
expressly describes displaying **your jobs** on another website. The current
[Job Postings JSON Endpoint](https://developers.pinpointhq.com/docs/jobs-json-endpoint)
documents `https://{tenant}.pinpointhq.com/postings.json`, client-side fetching, full
description sections, and the provider listing URL. This is credible intended-use
documentation, stronger than observing an unauthenticated response. It does not
expressly license copying every employer's postings into an independent commercial
catalog.

The [third-party integration requirements](https://developers.pinpointhq.com/docs/3rd-party-vendors-integrations)
ask vendors building for mutual clients to notify Pinpoint before development,
send `x-vendor-name:{vendor-name}`, and provide a help guide, demonstration, and
integration listing information after development. These instructions concern
client integrations; their applicability to a public-feed-only aggregator is not
stated. The header identifies the integration; it is not a visible attribution
license. No outreach or form submission was performed.

**Release evidence needed:** a publisher policy or employer authorization covering
ApplySmooth's copying/display, plus a documented determination of which vendor
requirements apply. No broad redistribution ban was located in the reviewed feed
documents. Tenant-specific conditions can differ: one unrelated Pinpoint tenant's
[published policy](https://overlandpartners.pinpointhq.com/en/privacy-policy)
expressly limits copying to personal noncommercial use. That example is not a
claim about the currently sampled tenants; it shows why platform access alone
cannot clear every employer.

## Breezy HR

[Embedding Jobs on Your Website](https://help.breezy.hr/en/articles/5376777-embedding-jobs-on-your-website)
documents a company-admin configured widget for the company's own website. The
[official API overview](https://developer.breezy.hr/reference/overview) documents
the separate `api.breezy.hr/v3` service. Neither reviewed document establishes an
independent publisher license for the collector's employer `/json` feed and detail
page requests.

The current [Terms of Service](https://breezy.hr/policies/terms), updated August 10,
2026, §5(ix), restrict access/search to publicly supported interfaces and give
scraping as an example of disallowed access. Section 3 leaves content ownership
with the customer and grants distribution rights to Breezy and third-party
services it works with; it does not identify arbitrary aggregators as licensees.
This is a concrete access restriction, not merely silence about reuse.

**Release evidence needed:** confirmation that the exact `/json` and HTML/JSON-LD
detail workflow is supported for ApplySmooth, and authorization to republish the
employer content. The implemented loader also extracts HTML description containers
when JSON-LD is absent, so treating all detail reads as a documented API would be
inaccurate. A working public endpoint and a provider-name credit do not resolve
these points.

## Manatal

The [career-page list reference](https://developers.manatal.com/reference/career-page_jobs_list)
documents the exact `api.manatal.com/open/v3/career-page/{client_slug}/jobs/`
endpoint used by the adapter. The [company website integration guide](https://support.manatal.com/docs/advanced-career-page-integration)
supports listing the customer's published jobs and retrieving details through its
career-page API, alongside linking and iframe options. It directs customers to
support for API integration information. Thus the API has a legitimate documented
integration purpose; it is not a general open-content license.

The [Terms and Conditions](https://www.manatal.com/terms-and-conditions), effective
September 7, 2026, under **Certain Uses Require Manatal Consent**, require prior
express written consent for automatic enquiries/requests except programs made
available by Manatal. The intellectual-property/content sections separately limit
commercial exploitation and copying/publication, subject to permission and legal
exceptions. Customer-selected job distribution is described elsewhere in those
terms; it does not automatically authorize ApplySmooth as a distributor.

**Release evidence needed:** a documented permitted integration/consent covering
this collector and employer content rights. Resolve the relationship between the
documented career API and the automation restriction for this use; do not assume
all API use is forbidden or all unauthenticated API use is licensed. Unknown
original dates in the existing sample remain a separate quality limitation.

## Trakstar Hire / Recruiterbox

The official [Frontend API reference](https://apiv1.recruiterbox.com/frontend_api.html)
documents public openings and detail requests with `client_name`, including full
descriptions and `hosted_url`. The examples do not require account credentials.
This is distinct from the [account API](https://support.hire.trakstar.com/article/1617-accessing-the-hire-api),
which requires a customer account, Super Admin, and generated API key. Do not
mistake those private-API prerequisites for the public frontend endpoint's access
requirements.

The current [Trakstar subscription terms](https://mitratech.com/legal-notice/trakstar/trakstar-terms-and-conditions/),
updated July 28, 2026, §1.7(b), contain a screen-scraping restriction; §1.9(b)
describes client-authorized third-party access and requires sufficient rights in
client data. These are customer-contract provisions, not an explicit statement
that every public frontend read is prohibited. They also do not grant unrelated
publishers universal reuse rights. The [Acceptable Use Policy](https://www.trakstar.com/acceptable-use-policy/)
requires rights to distributed content and forbids unauthorized access and
misrepresenting affiliation.

**Release evidence needed:** employer/publisher authorization for redistribution
and confirmation of the allowed date-metadata route. The current loader fetches
hosted HTML pages after the API to recover original dates. That extra extraction
is not described by the frontend API reference and needs separate resolution;
the supported public API is not evidence that all HTML extraction is permitted.

## Attribution and next concrete gate

The implemented credit/link pairs are:

| Source | Current credit | Current credit URL |
| --- | --- | --- |
| Pinpoint | `Pinpoint` | `https://{tenant}.pinpointhq.com` |
| Breezy | `Breezy HR` | `https://{tenant}.breezy.hr` |
| Manatal | `Manatal` | `https://www.careers-page.com/{tenant}` |
| Trakstar | `Trakstar Hire` | `https://{tenant}.hire.trakstar.com` |

These are existing ApplySmooth provenance choices, not provider-mandated
attribution formulas discovered in this review. Preserve employer identity and
original application links, and avoid implying a partnership. Attribution alone
does not supply missing access or content rights. No numeric public rate allowance
for these exact four collection routes was established in this review.

Before production activation, attach scoped publisher documentation or existing
authorization covering the selected employers, full-text display, caching,
application links, and any page extraction. Record exact provider conditions and
their implementation. Keep technical TEST acceptance separate from this unresolved
publication gate; this review changes no contracts, manifests, or workflow state.
