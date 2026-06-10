# QA Issue Taxonomy

## Severity Levels

| Severity | Definition | Examples |
| --- | --- | --- |
| Critical | Blocks a core workflow, causes data loss, or crashes the app | Form submit causes error page, checkout flow broken, data deleted without confirmation |
| High | Major feature broken or unusable, no workaround | Search returns wrong results, file upload silently fails, auth redirect loop |
| Medium | Feature works but with noticeable problems, workaround exists | Slow page load over 5 seconds, missing form validation while submit still works, layout broken on mobile only |
| Low | Minor cosmetic or polish issue | Typo in footer, 1px alignment issue, hover state inconsistent |

## Categories

### Visual/UI

- Layout breaks, overlapping elements, clipped text, horizontal scrollbars
- Broken or missing images
- Incorrect z-index, with elements appearing behind others
- Font or color inconsistencies
- Animation glitches, jank, or incomplete transitions
- Alignment issues, uneven spacing, or off-grid elements
- Dark mode or theme issues

### Functional

- Broken links, 404s, or wrong destinations
- Dead buttons where clicking does nothing
- Missing, wrong, or bypassable form validation
- Incorrect redirects
- State not persisting across refresh or back navigation
- Race conditions such as double-submit or stale data
- Search returning wrong results or no results

### UX

- Confusing navigation, missing breadcrumbs, or dead ends
- Missing loading indicators
- Slow interactions with no feedback
- Unclear error messages
- No confirmation before destructive actions
- Inconsistent interaction patterns across pages
- No clear way back or next action

### Content

- Typos and grammar errors
- Outdated or incorrect text
- Placeholder or lorem ipsum text left in
- Truncated text without ellipsis or expansion affordance
- Wrong labels on buttons or form fields
- Missing or unhelpful empty states

### Performance

- Slow page loads
- Janky scrolling or dropped frames
- Layout shifts after load
- Excessive network requests
- Large unoptimized images
- Blocking JavaScript that makes the page unresponsive

### Console/Errors

- JavaScript exceptions
- Failed network requests
- Deprecation warnings that signal upcoming breakage
- CORS errors
- Mixed content warnings
- CSP violations

### Accessibility

- Missing alt text on images
- Unlabeled form inputs
- Broken keyboard navigation
- Focus traps that cannot be escaped
- Missing or incorrect ARIA attributes
- Insufficient color contrast
- Content unreachable by screen reader

## Per-Page Exploration Checklist

For each page visited during a QA session:

1. Visual scan: capture a screenshot and look for layout issues, broken images, and alignment problems.
2. Interactive elements: click every button, link, and control. Verify each does what it says.
3. Forms: fill and submit. Test empty submission, invalid data, edge cases, long text, and special characters when relevant.
4. Navigation: check all paths in and out, including breadcrumbs, back button, deep links, and mobile menus.
5. States: check empty, loading, error, full, and overflow states.
6. Console: inspect errors after interactions and note failed requests.
7. Responsiveness: check mobile and tablet viewports when relevant.
8. Auth boundaries: check logged-out behavior and different user roles when relevant.
