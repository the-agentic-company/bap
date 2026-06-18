import { limitOf, type OperationContext } from "./context";
import { mapCommentSummary, mapPostSummary } from "./mappers";

type JsonValue = ReturnType<typeof JSON.parse>;
type JsonRecord = Record<string, JsonValue>;

/**
 * Post, comment, reaction and company-page operations. Reads that list many items use
 * the shared {@link mapPostSummary}/{@link mapCommentSummary} transforms; writes go
 * straight through the transport.
 */

export async function createPost(
  ctx: OperationContext,
  text: string,
  visibility = "PUBLIC",
): Promise<void> {
  const { client } = ctx;
  const data = await client.request("/posts", {
    method: "POST",
    body: JSON.stringify({ account_id: client.accountId, text, visibility }),
  });
  console.log(JSON.stringify({ success: true, postId: data.post_id }, null, 2));
}

export async function getPost(ctx: OperationContext, postId: string): Promise<void> {
  const { client } = ctx;
  const data = await client.request(`/posts/${postId}?account_id=${client.accountId}`);
  console.log(
    JSON.stringify(
      {
        id: data.id,
        text: data.text,
        author: { id: data.author?.provider_id, name: data.author?.display_name },
        likesCount: data.likes_count,
        commentsCount: data.comments_count,
        sharesCount: data.shares_count,
        createdAt: data.created_at,
      },
      null,
      2,
    ),
  );
}

export async function listPosts(ctx: OperationContext, profileId?: string): Promise<void> {
  const { client, directory, values } = ctx;
  const providerId = await directory.resolveProfileProviderId(profileId);
  const limit = limitOf(values, "20");
  const params = new URLSearchParams({ account_id: client.accountId, limit: limit.toString() });
  if (values.cursor) {
    params.set("cursor", values.cursor);
  }

  const data = await client.request(`/users/${encodeURIComponent(providerId)}/posts?${params}`);
  const items = Array.isArray(data.items) ? (data.items as JsonRecord[]) : [];
  const posts = items.map(mapPostSummary);

  console.log(JSON.stringify({ items: posts, cursor: data.cursor }, null, 2));
}

export async function listPostComments(
  ctx: OperationContext,
  postId: string,
  commentId?: string,
): Promise<void> {
  const { client, values } = ctx;
  const limit = limitOf(values, "20");
  const params = new URLSearchParams({ account_id: client.accountId, limit: limit.toString() });
  if (values.cursor) {
    params.set("cursor", values.cursor);
  }
  if (commentId) {
    params.set("comment_id", commentId);
  }
  if (values["sort-by"]) {
    params.set("sort_by", values["sort-by"]);
  }

  const data = await client.request(`/posts/${encodeURIComponent(postId)}/comments?${params}`);
  const items = Array.isArray(data.items) ? (data.items as JsonRecord[]) : [];
  const comments = items.map(mapCommentSummary);

  console.log(JSON.stringify({ items: comments, cursor: data.cursor }, null, 2));
}

export async function commentOnPost(
  ctx: OperationContext,
  postId: string,
  text: string,
  replyToCommentId?: string,
): Promise<void> {
  const { client } = ctx;
  const body = new FormData();
  body.set("account_id", client.accountId);
  body.set("text", text);
  if (replyToCommentId) {
    body.set("comment_id", replyToCommentId);
  }

  const data = await client.request(`/posts/${postId}/comments`, {
    method: "POST",
    body,
    headers: { Accept: "application/json" },
  });
  console.log(
    JSON.stringify(
      {
        success: true,
        commentId: data.comment_id,
        repliedToCommentId: replyToCommentId ?? null,
      },
      null,
      2,
    ),
  );
}

export async function reactToPost(
  ctx: OperationContext,
  postId: string,
  reactionType: string,
): Promise<void> {
  const { client } = ctx;
  await client.request("/posts/reaction", {
    method: "POST",
    body: JSON.stringify({
      account_id: client.accountId,
      post_id: postId,
      reaction_type: reactionType.toUpperCase(),
    }),
  });
  console.log(JSON.stringify({ success: true, message: `Reacted with ${reactionType}` }, null, 2));
}

export async function listCompanyPosts(ctx: OperationContext, companyId: string): Promise<void> {
  const { client, directory, values } = ctx;
  const providerId = await directory.resolveCompanyProviderId(companyId);
  const limit = limitOf(values, "20");
  const params = new URLSearchParams({
    account_id: client.accountId,
    limit: limit.toString(),
    is_company: "true",
  });
  if (values.cursor) {
    params.set("cursor", values.cursor);
  }

  const data = await client.request(`/users/${encodeURIComponent(providerId)}/posts?${params}`);
  const items = Array.isArray(data.items) ? (data.items as JsonRecord[]) : [];
  const posts = items.map(mapPostSummary);

  console.log(JSON.stringify({ items: posts, cursor: data.cursor }, null, 2));
}

export async function createCompanyPost(
  ctx: OperationContext,
  companyId: string,
  text: string,
): Promise<void> {
  const { client, directory } = ctx;
  const organizationId = await directory.resolveCompanyProviderId(companyId);
  const data = await client.request("/posts", {
    method: "POST",
    body: JSON.stringify({
      account_id: client.accountId,
      as_organization: organizationId,
      text,
    }),
  });
  console.log(JSON.stringify({ success: true, postId: data.post_id }, null, 2));
}
