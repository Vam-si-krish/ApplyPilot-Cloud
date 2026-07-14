import { AsyncLocalStorage } from 'node:async_hooks';

const users = new AsyncLocalStorage();

export function currentUserId() {
  return users.getStore() || null;
}

export function runAsUser(userId, work) {
  return users.run(userId, work);
}

export function validUserId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
