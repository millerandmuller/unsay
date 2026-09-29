// In-memory outcome tracker for callback calls. A single server process
// handles a call's entire lifecycle (place -> stream -> status callback),
// so this doesn't need to survive a restart.
export interface CallResolution {
  entryId: string;
  status: "confirmed" | "rejected";
  value?: string;
}

const resolutions = new Map<string, CallResolution>();

export function setResolution(callId: string, resolution: CallResolution): void {
  resolutions.set(callId, resolution);
}

export function getResolution(callId: string): CallResolution | undefined {
  return resolutions.get(callId);
}

export function clearResolution(callId: string): void {
  resolutions.delete(callId);
}
