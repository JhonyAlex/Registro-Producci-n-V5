/**
 * Offline Queue Service
 * 
 * Persists pending production records in localStorage keyed by userId.
 * Records survive browser restarts, session expiry and tab closes.
 * The queue is flushed automatically whenever the app is back online
 * and the user is authenticated.
 */
import { ProductionRecord } from '../types';

const queueKey = (userId: string) => `offline_queue_v1_${userId}`;

export interface QueuedRecord {
  record: ProductionRecord;
  queuedAt: number;
}

// Custom event to let React components react to queue changes
const QUEUE_CHANGED_EVENT = 'offlinequeue:changed';

const notifyChange = () => {
  try { window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT)); } catch { /* noop */ }
};

/** Subscribe to any addition or removal from the queue. Returns unsubscribe fn. */
export const onQueueChanged = (cb: () => void): (() => void) => {
  window.addEventListener(QUEUE_CHANGED_EVENT, cb);
  return () => window.removeEventListener(QUEUE_CHANGED_EVENT, cb);
};

export const getQueue = (userId: string): QueuedRecord[] => {
  try {
    const raw = localStorage.getItem(queueKey(userId));
    return raw ? (JSON.parse(raw) as QueuedRecord[]) : [];
  } catch {
    return [];
  }
};

export const getQueueCount = (userId: string): number => getQueue(userId).length;

/** Add or update a record in the queue (upsert by record.id). */
export const addToQueue = (userId: string, record: ProductionRecord): void => {
  const queue = getQueue(userId);
  const idx = queue.findIndex(item => item.record.id === record.id);
  const entry: QueuedRecord = { record, queuedAt: Date.now() };
  if (idx >= 0) {
    queue[idx] = entry;
  } else {
    queue.push(entry);
  }
  localStorage.setItem(queueKey(userId), JSON.stringify(queue));
  notifyChange();
};

const removeFromQueue = (userId: string, recordId: string): void => {
  const queue = getQueue(userId).filter(item => item.record.id !== recordId);
  localStorage.setItem(queueKey(userId), JSON.stringify(queue));
  notifyChange();
};

export interface SyncResult {
  synced: number;
  failed: number;
}

/**
 * Attempts to POST every queued record to the server.
 * Stops on session expiry (401/403) or network error — the queue
 * is not cleared in those cases so it can be retried later.
 */
export const flushQueue = async (userId: string): Promise<SyncResult> => {
  const queue = getQueue(userId);
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      const res = await fetch('/api/records', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
        body: JSON.stringify(item.record),
      });

      if (res.ok) {
        removeFromQueue(userId, item.record.id);
        synced++;
      } else if (res.status === 401 || res.status === 403) {
        // Session expired — preserve queue, retry on next login
        break;
      } else {
        failed++;
      }
    } catch {
      // Network error — stop, retry on next reconnect
      failed++;
      break;
    }
  }

  return { synced, failed };
};
