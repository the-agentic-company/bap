export type SegmentApprovalStatus = "pending" | "approved" | "denied";

export type SegmentApprovalForFiltering = {
  interruptId?: string;
  toolUseId: string;
  toolName?: string;
  toolInput?: unknown;
  integration?: string;
  operation?: string;
  status: SegmentApprovalStatus;
};

export type SegmentForApprovalFiltering<TItem = unknown> = {
  id: string;
  items: TItem[];
  approval?: SegmentApprovalForFiltering;
};

function getResolvedApprovalIds<TItem>(segments: SegmentForApprovalFiltering<TItem>[]): {
  interruptIds: Set<string>;
  toolUseIds: Set<string>;
} {
  const interruptIds = new Set<string>();
  const toolUseIds = new Set<string>();

  for (const segment of segments) {
    const approval = segment.approval;
    if (!approval || approval.status === "pending") {
      continue;
    }

    toolUseIds.add(approval.toolUseId);
    if (approval.interruptId) {
      interruptIds.add(approval.interruptId);
    }
  }

  return { interruptIds, toolUseIds };
}

export function getApprovalLocalResolutionKeys(approval: {
  toolUseId?: string;
  interruptId?: string;
  toolName?: string;
  toolInput?: unknown;
  integration?: string;
  operation?: string;
}): string[] {
  const keys: string[] = [];
  if (approval.toolUseId) {
    keys.push(`tool:${approval.toolUseId}`);
  }
  if (approval.interruptId) {
    keys.push(`interrupt:${approval.interruptId}`);
  }
  if (
    approval.toolName &&
    approval.integration &&
    approval.operation &&
    (approval.operation === "question" || approval.toolName.toLowerCase() === "question") &&
    approval.integration === "cmdclaw"
  ) {
    try {
      keys.push(`question:${JSON.stringify(approval.toolInput)}`);
    } catch {
      // ID-based keys above still cover non-serializable inputs.
    }
  }
  return keys;
}

export function filterLocallyResolvedPendingApprovalSegments<
  TSegment extends SegmentForApprovalFiltering,
>(segments: TSegment[], localResolutionKeys: Set<string>): TSegment[] {
  if (localResolutionKeys.size === 0) {
    return segments;
  }

  return segments.filter((segment) => {
    const approval = segment.approval;
    if (!approval || approval.status !== "pending") {
      return true;
    }

    return !getApprovalLocalResolutionKeys(approval).some((key) => localResolutionKeys.has(key));
  });
}

export function filterResolvedDuplicateApprovalSegments<
  TSegment extends SegmentForApprovalFiltering,
>(segments: TSegment[]): TSegment[] {
  const resolvedIds = getResolvedApprovalIds(segments);
  if (resolvedIds.interruptIds.size === 0 && resolvedIds.toolUseIds.size === 0) {
    return segments;
  }

  return segments.filter((segment) => {
    const approval = segment.approval;
    if (!approval || approval.status !== "pending") {
      return true;
    }

    if (resolvedIds.toolUseIds.has(approval.toolUseId)) {
      return false;
    }

    return !approval.interruptId || !resolvedIds.interruptIds.has(approval.interruptId);
  });
}
