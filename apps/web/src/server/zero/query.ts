import { mustGetQuery } from "@rocicorp/zero";
import { handleQueryRequest } from "@rocicorp/zero/server";
import { getRequestSession } from "@/server/session-auth";
import { resolveSessionPrincipalWorkspaceId } from "@/server/session-principal-workspace";
import { zeroQueries, type ZeroQueryContext } from "@/zero/queries";
import { schema } from "@/zero/schema";

export async function handleZeroQueryRequest(request: Request): Promise<Response> {
  const sessionData = await getRequestSession(request.headers);
  const userId = sessionData?.user?.id;

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await resolveSessionPrincipalWorkspaceId(
    userId,
    (sessionData?.session as { activeOrganizationId?: string | null } | undefined)
      ?.activeOrganizationId ?? null,
  );
  const ctx: ZeroQueryContext = { userId, workspaceId };

  const result = await handleQueryRequest({
    handler: (name, args) => {
      const query = mustGetQuery(zeroQueries, name);
      return query.fn({ args, ctx });
    },
    schema,
    request,
    userID: userId,
  });

  return Response.json(result);
}
