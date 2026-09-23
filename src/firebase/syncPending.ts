// Flush helper kept separate so barrel stays a pure re-export module

import { flushAllPendingSaves } from './saveQueue';

export const syncPendingChanges = async (_uid: string): Promise<void> => {
  await flushAllPendingSaves();
};
