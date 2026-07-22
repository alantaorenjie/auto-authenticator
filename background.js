/**
 * Background service worker for Authenticator Extension
 * Handles tab capture, messaging relay
 */

// Storage key for accounts
const STORAGE_KEY = 'authenticator_accounts';

// Default data
const DEFAULT_DATA = { accounts: [] };

/**
 * Initialize default data
 */
async function initStorage() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  if (!data[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_DATA });
  }
}

/**
 * Get all accounts from storage
 */
async function getAccounts() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY]?.accounts || [];
}

/**
 * Save accounts to storage
 */
async function saveAccounts(accounts) {
  await chrome.storage.local.set({ [STORAGE_KEY]: { accounts } });
}

/**
 * Capture the visible tab and return a data URL
 */
async function captureVisibleTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab found');
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return dataUrl;
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getAccounts':
      getAccounts().then(accounts => sendResponse({ accounts }));
      return true;

    case 'saveAccounts':
      saveAccounts(message.accounts).then(() => sendResponse({ success: true }));
      return true;

    case 'captureTab':
      captureVisibleTab()
        .then(dataUrl => sendResponse({ dataUrl }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
  }
});

// Initialize on install/update
chrome.runtime.onInstalled.addListener(() => {
  initStorage();
});

initStorage();
