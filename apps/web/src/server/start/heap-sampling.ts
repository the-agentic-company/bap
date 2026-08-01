import { Session } from "node:inspector";
import { getHeapSpaceStatistics, getHeapStatistics } from "node:v8";

type SamplingNode = {
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
  selfSize: number;
  children: SamplingNode[];
};

type SamplingProfile = {
  head: SamplingNode;
};

const HEAP_SAMPLE_INTERVAL_BYTES = 256 * 1024;
const HEAP_REPORT_INTERVAL_MS = 60_000;
const HEAP_REPORT_LIMIT = 20;

const heapSamplingGlobal = globalThis as typeof globalThis & {
  bapHeapSamplingStarted?: boolean;
};

function compactSource(url: string): string {
  if (!url) {
    return "<native>";
  }
  const marker = "/app/";
  const markerIndex = url.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return url.slice(markerIndex + 1);
  }
  return url.length > 160 ? `…${url.slice(-159)}` : url;
}

export function summarizeHeapSamplingProfile(
  profile: SamplingProfile,
  limit = HEAP_REPORT_LIMIT,
): Array<{ allocationSite: string; sampledBytes: number }> {
  const bytesBySite = new Map<string, number>();
  const visit = (node: SamplingNode): void => {
    if (node.selfSize > 0) {
      const frame = node.callFrame;
      const allocationSite = `${frame.functionName || "<anonymous>"} (${compactSource(frame.url)}:${frame.lineNumber + 1})`;
      bytesBySite.set(allocationSite, (bytesBySite.get(allocationSite) ?? 0) + node.selfSize);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(profile.head);

  return Array.from(bytesBySite, ([allocationSite, sampledBytes]) => ({
    allocationSite,
    sampledBytes,
  }))
    .toSorted((left, right) => right.sampledBytes - left.sampledBytes)
    .slice(0, limit);
}

function summarizeActiveResources(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const resource of process.getActiveResourcesInfo()) {
    counts[resource] = (counts[resource] ?? 0) + 1;
  }
  return counts;
}

function reportHeapProfile(session: Session): void {
  session.post("HeapProfiler.getSamplingProfile", (error, result) => {
    if (error) {
      console.warn("[HeapSampling] Could not read sampling profile", error.message);
      return;
    }

    const memory = process.memoryUsage();
    console.warn(
      "[HeapSampling]",
      JSON.stringify({
        memory,
        heap: getHeapStatistics(),
        spaces: getHeapSpaceStatistics().map((space) => ({
          name: space.space_name,
          usedBytes: space.space_used_size,
          sizeBytes: space.space_size,
        })),
        activeResources: summarizeActiveResources(),
        topAllocations: summarizeHeapSamplingProfile(result.profile as SamplingProfile),
      }),
    );
  });
}

export function initializeHeapSamplingDiagnostics(): void {
  if (
    process.env.APP_HEAP_SAMPLING_ENABLED !== "true" ||
    heapSamplingGlobal.bapHeapSamplingStarted
  ) {
    return;
  }
  heapSamplingGlobal.bapHeapSamplingStarted = true;

  const session = new Session();
  session.connect();
  session.post(
    "HeapProfiler.startSampling",
    {
      samplingInterval: HEAP_SAMPLE_INTERVAL_BYTES,
      includeObjectsCollectedByMajorGC: false,
      includeObjectsCollectedByMinorGC: false,
    },
    (error) => {
      if (error) {
        heapSamplingGlobal.bapHeapSamplingStarted = false;
        session.disconnect();
        console.warn("[HeapSampling] Could not start sampling", error.message);
        return;
      }

      console.warn("[HeapSampling] Allocation sampling enabled");
      const interval = setInterval(() => reportHeapProfile(session), HEAP_REPORT_INTERVAL_MS);
      interval.unref();
    },
  );
}
