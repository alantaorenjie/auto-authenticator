/**
 * Background service worker for Authenticator Extension
 * Handles tab capture, messaging relay, TOTP generation for auto-fill
 */

import { generateTOTP } from './totp.js';

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

/**
 * Generate TOTP code matching the detected login account, or fall back to first account
 * @param {string} [hint] - Optional account hint (email/username) detected from the page
 */
async function getMatchingAccountCode(hint) {
  const accounts = await getAccounts();
  if (accounts.length === 0) return null;

  let matched = null;

  // If we have a hint, try to find a matching account
  if (hint) {
    const hl = hint.toLowerCase().trim();

    // Try exact match on account field
    matched = accounts.find(a => a.account && a.account.toLowerCase() === hl);

    // Try account contains hint (e.g. "user@example.com" contains "user")
    if (!matched) {
      matched = accounts.find(a => a.account && a.account.toLowerCase().includes(hl));
    }

    // Try hint contains account (partial match)
    if (!matched) {
      matched = accounts.find(a => a.account && hl.includes(a.account.toLowerCase()));
    }

    // Try match by local part of email (e.g. "user" from "user@example.com")
    if (!matched && hl.includes('@')) {
      const localPart = hl.split('@')[0];
      matched = accounts.find(a => a.account && a.account.toLowerCase().includes(localPart));
    }

    // Try match issuer against the hint
    if (!matched) {
      matched = accounts.find(a => a.issuer && a.issuer.toLowerCase().includes(hl));
    }
  }

  // If no match, use the first account as fallback
  if (!matched) {
    const sorted = [...accounts].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (a.order || a.createdAt || 0) - (b.order || b.createdAt || 0);
    });
    matched = sorted[0];
  }

  const code = await generateTOTP(matched.secret);
  return { code, issuer: matched.issuer, account: matched.account };
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

    case 'requestAutoFill':
      getMatchingAccountCode(message.accountHint)
        .then(result => sendResponse(result))
        .catch(() => sendResponse({ code: null }));
      return true;
  }
});

// Initialize on install/update
chrome.runtime.onInstalled.addListener(() => {
  initStorage();
});

initStorage();
