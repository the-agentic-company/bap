import {
  downloadWorkspaceImageForUser,
  downloadWorkspaceImageWithSignature,
} from "@bap/core/server/billing/workspace-image";
import { getRequestSession, getRequestSessionCandidates } from "@/server/session-auth";

function imageResponse(image: { body: Buffer; mimeType: string }): Response {
  return new Response(new Uint8Array(image.body), {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": image.body.byteLength.toString(),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function downloadWorkspaceImage(
  request: Request,
  workspaceId: string,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const signedImage = await downloadWorkspaceImageWithSignature(
    workspaceId,
    requestUrl.searchParams.get("s"),
  );
  if (signedImage) {
    return imageResponse(signedImage);
  }

  const sessionData = await getRequestSession(request.headers);
  if (!sessionData?.user?.id) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let image = await downloadWorkspaceImageForUser(sessionData.user.id, workspaceId);
  if (!image) {
    const sessionCandidates = await getRequestSessionCandidates(request.headers);
    const candidateImages = await Promise.all(
      sessionCandidates
        .filter((candidate) => candidate.user.id !== sessionData.user.id)
        .map((candidate) => downloadWorkspaceImageForUser(candidate.user.id, workspaceId)),
    );
    image = candidateImages.find(Boolean) ?? null;
  }

  if (!image) {
    return Response.json(
      { error: "Workspace image not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return imageResponse(image);
}
