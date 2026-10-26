# Shortlist Application Helper

This is an unpacked Chrome / Edge Manifest V3 extension. It is not a Chrome Web Store release.

## Install

1. Extract the extension ZIP to a folder you will keep.
2. Open chrome://extensions or edge://extensions.
3. Enable Developer mode, choose Load unpacked and select the folder containing manifest.json.
4. Pin Shortlist Application Helper to the toolbar.

## Import your saved resume information

Open your Shortlist dashboard at http://127.0.0.1:5173, sign in if needed, then click the extension and Import from dashboard tab. For a deployed dashboard, change Dashboard address first. The import reads only the saved /api/v1/profile response from that origin, using your existing dashboard session.

Alternatively use Settings → Verified profile → Export autofill profile JSON and import that file in the extension. PDF/DOCX parsing remains in Shortlist: upload the master resume there, import and verify the saved profile, then transfer it here. Review and edit the helper's details after import. Name parts and simple location/education/current-role fields are derived from the supplied text; confirm them for your own name and resume conventions. No salary, eligibility, sponsorship, demographic or consent answers are invented.

## Fill an application

Open the actual application form, click the helper and choose Preview matching fields. Uncheck any suggestions you do not want to fill, then click Fill selected fields. Supported controls include labelled native text inputs, textareas and exact-match selects. Name, contact, links, location, current employment, school/degree, graduation year, skills and summary can be filled when supplied in your profile. Fields in open shadow roots and accessible same-origin frames are inspected. Cross-origin frames, closed shadow roots, custom dropdowns and protected forms may require manual entry. Open an embedded form directly in its own tab when needed. Preview again for every step of a multi-page application.

Choose a PDF or DOCX under 4 MB to store a resume locally. Enable Include this resume in the preview for an application that should receive it. Resume/CV file inputs are matched separately from cover letters and supporting documents. The file must match the field's accepted types. Choose the resume tailored for that role; it is not automatically selected by the helper.

Existing answers are preserved. The helper never clicks submit, checks consent boxes, bypasses CAPTCHA, or answers unknown screening questions. Undo last fill restores unchanged helper-filled values while preserving edits made afterward; it only works while that page is still open. File changes may trigger the site's normal upload handler, and undo cannot retract an upload the site has already received.

## Data and permissions

The only permissions are activeTab, scripting and storage. There are no persistent website host permissions, content-script registrations, remote code, telemetry or external autofill servers. Profile and optional resume bytes are stored with chrome.storage.local, not synchronized across devices. Only trusted extension contexts can read this storage. Preview temporarily grants the helper access to the active page; it injects packaged code and fills only the fields you select. Like typing and choosing a file yourself, filling exposes those selected values to the application site and its event handlers. Clear saved profile and resume removes the extension's local copies; it does not change Shortlist or any submitted application.

## Validation

DOM regression tests cover field recognition, preview-before-fill, existing values, exact select matching, React-compatible native setters/events, files, sensitive-field exclusions, same-origin frames, shadow roots and undo. The manifest and packaged assets are checked. Real employer sites have different controls, so this does not imply support for every ATS or replace reviewing the completed application. The extension has not been installed in your browser automatically or published to a store.

Chrome references: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab ; https://developer.chrome.com/docs/extensions/reference/api/scripting ; https://developer.chrome.com/docs/extensions/reference/api/storage
