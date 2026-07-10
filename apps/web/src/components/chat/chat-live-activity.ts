export function shouldRenderLiveActivity(params: {
  displaySegmentCount: number;
  isStreaming: boolean;
  suppressLiveActivity: boolean;
}): boolean {
  return !params.suppressLiveActivity && params.isStreaming;
}

export function shouldRenderInitialLiveActivity(params: {
  displaySegmentCount: number;
  isStreaming: boolean;
  suppressLiveActivity: boolean;
}): boolean {
  return !params.suppressLiveActivity && params.isStreaming && params.displaySegmentCount === 0;
}
