import { normalizeLinkedInProfileIdentifier } from "./identifiers";

type JsonValue = ReturnType<typeof JSON.parse>;
type JsonRecord = Record<string, JsonValue>;

/**
 * Pure transforms from raw Unipile JSON into the stable shapes the CLI prints.
 *
 * Unipile returns several historical field spellings for the same datum (e.g.
 * `reaction_counter` vs `likes_count`). These mappers concentrate every one of those
 * fallback decisions so the rest of the skill — and its output contract — never has to
 * know about them.
 */

export type UserSummary = {
  id: string | null;
  name: string | null;
  username: string | null;
  headline: string | null;
  profileUrl: string | null;
};

function asRecord(value: JsonValue): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function firstString(...candidates: JsonValue[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return null;
}

function firstNumber(...candidates: JsonValue[]): number | null {
  for (const candidate of candidates) {
    if (typeof candidate === "number") {
      return candidate;
    }
  }
  return null;
}

/** Shape a `/users/:id` profile response into a {@link UserSummary}. */
export function mapUserSummary(profile: JsonRecord): UserSummary {
  const firstName = typeof profile.first_name === "string" ? profile.first_name : "";
  const lastName = typeof profile.last_name === "string" ? profile.last_name : "";
  const fullName = `${firstName} ${lastName}`.trim();

  return {
    id: typeof profile.provider_id === "string" ? profile.provider_id : null,
    name:
      (typeof profile.display_name === "string" ? profile.display_name : null) ||
      (fullName.length > 0 ? fullName : null),
    username: normalizeLinkedInProfileIdentifier(profile.public_identifier),
    headline: typeof profile.headline === "string" ? profile.headline : null,
    profileUrl: normalizeLinkedInProfileIdentifier(profile.public_identifier),
  };
}

/** Shape a post (feed or profile) into the trimmed summary the CLI lists. */
export function mapPostSummary(post: JsonRecord) {
  const author = asRecord(post.author);

  return {
    id: post.social_id ?? post.id ?? null,
    text: typeof post.text === "string" ? post.text.slice(0, 200) : null,
    author: firstString(author?.name ?? null, author?.display_name ?? null),
    likesCount: firstNumber(post.reaction_counter ?? null, post.likes_count ?? null),
    commentsCount: firstNumber(post.comment_counter ?? null, post.comments_count ?? null),
    sharesCount: firstNumber(post.repost_counter ?? null, post.shares_count ?? null),
    createdAt: firstString(post.parsed_datetime ?? null, post.created_at ?? null),
    shareUrl: typeof post.share_url === "string" ? post.share_url : null,
  };
}

/** Shape a comment, reconciling Unipile's two author/field spellings into one record. */
export function mapCommentSummary(comment: JsonRecord) {
  const authorDetails = asRecord(comment.author_details);
  const author = asRecord(comment.author);
  const authorProfileUrl = firstString(
    authorDetails?.profile_url ?? null,
    author?.public_identifier ?? null,
  );

  return {
    id: firstString(comment.id, comment.provider_id),
    postId: firstString(comment.post_id, comment.post_urn),
    threadId: typeof comment.thread_id === "string" ? comment.thread_id : null,
    parentCommentId:
      typeof comment.parent_comment_id === "string" ? comment.parent_comment_id : null,
    text: typeof comment.text === "string" ? comment.text : null,
    authorName:
      typeof comment.author === "string"
        ? comment.author
        : typeof author?.public_identifier === "string"
          ? author.public_identifier
          : null,
    authorId: firstString(authorDetails?.id ?? null, author?.provider_id ?? null),
    authorHeadline: typeof authorDetails?.headline === "string" ? authorDetails.headline : null,
    authorProfileUrl,
    authorUsername: normalizeLinkedInProfileIdentifier(authorProfileUrl),
    networkDistance:
      typeof authorDetails?.network_distance === "string" ? authorDetails.network_distance : null,
    likesCount: firstNumber(comment.reaction_counter ?? null, comment.comment_like_count ?? null),
    repliesCount: firstNumber(comment.reply_counter ?? null, comment.child_comment_count ?? null),
    createdAt:
      typeof comment.date === "string"
        ? comment.date
        : typeof comment.created_at === "number"
          ? new Date(comment.created_at).toISOString()
          : null,
  };
}
