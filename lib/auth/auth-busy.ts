export const AUTH_BUSY_EVENT = 'pulsolocal:auth-busy';

let currentAuthBusy = false;

export function getAuthBusy(): boolean {
  return currentAuthBusy;
}

export function emitAuthBusy(busy: boolean): void {
  currentAuthBusy = busy;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<{ busy: boolean }>(AUTH_BUSY_EVENT, {
        detail: { busy },
      })
    );
  }
}
