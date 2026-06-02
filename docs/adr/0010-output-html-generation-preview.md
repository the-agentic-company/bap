# Render output.html as an authenticated Generation Output Preview

CmdClaw will treat a sandbox file named exactly `output.html` as a self-contained **Generation Output Preview** when preview support is enabled by the chat surface. The runtime will auto-collect `output.html` even when the assistant does not mention it, store it through the existing sandbox file path, and the web app will render it in a collapsible chat-side preview pane by fetching authenticated preview HTML and passing it to a sandboxed iframe as `srcDoc`.

**Consequences**

Preview rendering is opt-in per `ChatArea` caller, so the reusable chat component can support output previews without changing every chat surface at once. The initial rollout enables the panel only for normal chat routes.

The preview route serves only owned sandbox files named `output.html`, caps previewable HTML below the general sandbox file upload limit, and does not use presigned S3 URLs as iframe sources. The existing sandbox file download flow remains the way to download the raw file.

`output.html` must be a single self-contained document for v1. Relative asset bundles are not supported until CmdClaw introduces a broader artifact serving model.
