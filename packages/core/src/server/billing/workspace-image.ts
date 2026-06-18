import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "../../env";
import { db } from "@bap/db/client";
import { workspace, workspaceMember } from "@bap/db/schema";
import {
  convertImageThumbnail,
  IMAGE_THUMBNAIL_INPUT_EXTENSIONS,
  type ImageThumbnailInputMimeType,
} from "../image-thumbnail";
import { deleteFromS3, downloadFromS3, ensureBucket, uploadToS3 } from "../storage/s3-client";

const WORKSPACE_IMAGE_EXTENSIONS = IMAGE_THUMBNAIL_INPUT_EXTENSIONS;
type WorkspaceImageMimeType = ImageThumbnailInputMimeType;

export function buildWorkspaceImageUrl(input: {
  id: string;
  imageStorageKey?: string | null;
  updatedAt?: Date | null;
}): string | null {
  if (!input.imageStorageKey) {
    return null;
  }

  const path = `/api/workspaces/${encodeURIComponent(input.id)}/image`;
  const version = input.updatedAt instanceof Date ? input.updatedAt.getTime() : null;
  const signature = signWorkspaceImageUrl({
    imageStorageKey: input.imageStorageKey,
    workspaceId: input.id,
  });
  const searchParams = new URLSearchParams({ s: signature });
  if (version) {
    searchParams.set("v", version.toString());
  }
  return `${path}?${searchParams.toString()}`;
}

export async function buildWorkspaceImageDataUrl(input: {
  imageMimeType?: string | null;
  imageStorageKey?: string | null;
}): Promise<string | null> {
  if (
    !input.imageStorageKey ||
    !input.imageMimeType ||
    !(input.imageMimeType in WORKSPACE_IMAGE_EXTENSIONS)
  ) {
    return null;
  }

  const body = await downloadFromS3(input.imageStorageKey).catch(() => null);
  if (!body) {
    return null;
  }

  return `data:${input.imageMimeType};base64,${body.toString("base64")}`;
}

function signWorkspaceImageUrl(input: { workspaceId: string; imageStorageKey: string }): string {
  return createHmac("sha256", env.APP_SERVER_SECRET)
    .update(`${input.workspaceId}:${input.imageStorageKey}`)
    .digest("base64url");
}

function isValidWorkspaceImageSignature(input: {
  imageStorageKey: string;
  signature: string;
  workspaceId: string;
}): boolean {
  const expected = signWorkspaceImageUrl(input);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signature);

  return (
    actualBuffer.byteLength === expectedBuffer.byteLength &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function updateWorkspaceImage(args: {
  contentBase64: string;
  mimeType: WorkspaceImageMimeType;
  workspaceId: string;
}) {
  const existingWorkspace = await db.query.workspace.findFirst({
    where: eq(workspace.id, args.workspaceId),
    columns: {
      id: true,
      imageStorageKey: true,
    },
  });

  if (!existingWorkspace) {
    throw new Error("Workspace not found");
  }

  const converted = await convertImageThumbnail({
    contentBase64: args.contentBase64,
    mimeType: args.mimeType,
  });
  const storageKey = `workspace-images/${args.workspaceId}/${Date.now()}-${crypto.randomUUID()}.${
    converted.extension
  }`;

  await ensureBucket();
  await uploadToS3(storageKey, converted.buffer, converted.mimeType);

  let updatedWorkspace:
    | {
        id: string;
        name: string;
        slug: string | null;
        imageStorageKey: string | null;
        updatedAt: Date;
      }
    | undefined;
  try {
    [updatedWorkspace] = await db
      .update(workspace)
      .set({
        imageStorageKey: storageKey,
        imageMimeType: converted.mimeType,
      })
      .where(eq(workspace.id, args.workspaceId))
      .returning({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        imageStorageKey: workspace.imageStorageKey,
        updatedAt: workspace.updatedAt,
      });
  } catch (error) {
    await deleteFromS3(storageKey).catch(() => undefined);
    throw error;
  }

  if (!updatedWorkspace) {
    await deleteFromS3(storageKey).catch(() => undefined);
    throw new Error("Workspace not found");
  }

  if (
    existingWorkspace.imageStorageKey &&
    existingWorkspace.imageStorageKey !== updatedWorkspace.imageStorageKey
  ) {
    await deleteFromS3(existingWorkspace.imageStorageKey).catch(() => undefined);
  }

  return {
    id: updatedWorkspace.id,
    name: updatedWorkspace.name,
    slug: updatedWorkspace.slug,
    imageUrl: converted.dataUrl,
  };
}

export async function removeWorkspaceImage(workspaceId: string) {
  const existingWorkspace = await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    columns: {
      id: true,
      imageStorageKey: true,
    },
  });

  if (!existingWorkspace) {
    throw new Error("Workspace not found");
  }

  const [updatedWorkspace] = await db
    .update(workspace)
    .set({
      imageStorageKey: null,
      imageMimeType: null,
    })
    .where(eq(workspace.id, workspaceId))
    .returning({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      imageStorageKey: workspace.imageStorageKey,
      updatedAt: workspace.updatedAt,
    });

  if (!updatedWorkspace) {
    throw new Error("Workspace not found");
  }

  if (existingWorkspace.imageStorageKey) {
    await deleteFromS3(existingWorkspace.imageStorageKey).catch(() => undefined);
  }

  return {
    id: updatedWorkspace.id,
    name: updatedWorkspace.name,
    slug: updatedWorkspace.slug,
    imageUrl: buildWorkspaceImageUrl(updatedWorkspace),
  };
}

export async function downloadWorkspaceImageForUser(userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMember.findFirst({
    where: and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)),
    with: {
      workspace: {
        columns: {
          imageStorageKey: true,
          imageMimeType: true,
        },
      },
    },
  });

  if (
    !membership?.workspace?.imageStorageKey ||
    !membership.workspace.imageMimeType ||
    !(membership.workspace.imageMimeType in WORKSPACE_IMAGE_EXTENSIONS)
  ) {
    return null;
  }

  return {
    body: await downloadFromS3(membership.workspace.imageStorageKey),
    mimeType: membership.workspace.imageMimeType,
  };
}

export async function downloadWorkspaceImageWithSignature(
  workspaceId: string,
  signature: string | null,
) {
  if (!signature) {
    return null;
  }

  const dbWorkspace = await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    columns: {
      imageStorageKey: true,
      imageMimeType: true,
    },
  });

  if (
    !dbWorkspace?.imageStorageKey ||
    !dbWorkspace.imageMimeType ||
    !(dbWorkspace.imageMimeType in WORKSPACE_IMAGE_EXTENSIONS) ||
    !isValidWorkspaceImageSignature({
      imageStorageKey: dbWorkspace.imageStorageKey,
      signature,
      workspaceId,
    })
  ) {
    return null;
  }

  return {
    body: await downloadFromS3(dbWorkspace.imageStorageKey),
    mimeType: dbWorkspace.imageMimeType,
  };
}
