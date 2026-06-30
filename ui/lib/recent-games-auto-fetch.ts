export type AutoFetchStartedRef = {
  current: boolean;
};

export type AutoFetchScheduler<Handle = unknown> = {
  cancel: (handle: Handle) => void;
  schedule: (callback: () => void) => Handle;
};

export function scheduleRecentGamesAutoFetch<Handle>(
  startedRef: AutoFetchStartedRef,
  onFetch: () => void,
  scheduler: AutoFetchScheduler<Handle>,
) {
  if (startedRef.current) {
    return () => {};
  }

  const handle = scheduler.schedule(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    onFetch();
  });

  return () => scheduler.cancel(handle);
}
