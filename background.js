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
 * Domain → service name mapping for matching accounts to websites
 * Used when the login flow spans multiple pages (e.g. Aliyun)
 */
const DOMAIN_SERVICE_MAP = [
  // 阿里云
  ['aliyun.com', ['阿里云', 'aliyun', 'alibaba']],
  ['alibabacloud.com', ['阿里云', 'aliyun', 'alibabacloud']],
  // 微软
  ['microsoft.com', ['微软', 'microsoft', 'azure', 'office']],
  ['microsoftonline.com', ['微软', 'microsoft', 'office', 'azure']],
  ['live.com', ['微软', 'microsoft']],
  ['office.com', ['office', '微软', 'microsoft']],
  // Google
  ['google.com', ['google']],
  // 腾讯云
  ['tencent.com', ['腾讯', 'tencent']],
  ['qcloud.com', ['腾讯云', 'qcloud', 'tencent']],
  ['tencentcloud.com', ['腾讯云', 'tencentcloud', 'tencent']],
  // 华为云
  ['huawei.com', ['华为', 'huawei']],
  ['huaweicloud.com', ['华为云', 'huaweicloud', 'huawei']],
  // 币安
  ['binance.com', ['币安', 'binance']],
  // GitHub
  ['github.com', ['github', 'git hub']],
  // GitLab
  ['gitlab.com', ['gitlab', 'git lab']],
  // AWS
  ['amazon.com', ['aws', 'amazon']],
  ['aws.amazon.com', ['aws', 'amazon']],
  // Cloudflare
  ['cloudflare.com', ['cloudflare']],
];

/**
 * Match accounts by hostname (for multi-page login flows)
 * Finds accounts whose issuer name matches the current website
 */
function matchByHostname(accounts, hostname) {
  if (!hostname) return null;

  const hl = hostname.toLowerCase();

  // Find matching service names
  const serviceNames = [];
  for (const [domain, names] of DOMAIN_SERVICE_MAP) {
    if (hl.includes(domain) || domain.includes(hl.split('.')[0])) {
      serviceNames.push(...names);
    }
  }

  // Try fuzzy: issuer name in hostname or hostname part in issuer
  for (const account of accounts) {
    if (account.issuer) {
      const issuer = account.issuer.toLowerCase();
      for (const name of serviceNames) {
        if (issuer.includes(name) || name.includes(issuer)) {
          return account;
        }
      }
      // Direct match: issuer contains a domain segment
      for (const part of hl.split('.')) {
        if (part.length > 3 && issuer.includes(part)) {
          return account;
        }
      }
    }
  }

  return null;
}

/**
 * Generate TOTP code matching the detected login account or website hostname
 * @param {string} [hint] - Account hint (email/username) detected from the page
 * @param {string} [hostname] - Current page hostname for domain-based matching
 */
async function getMatchingAccountCode(hint, hostname) {
  const accounts = await getAccounts();
  if (accounts.length === 0) return null;

  let matched = null;

  // Priority 1: Match by account hint (works for single-page login)
  if (hint) {
    const hl = hint.toLowerCase().trim();
    matched = accounts.find(a => a.account && a.account.toLowerCase() === hl);
    if (!matched) matched = accounts.find(a => a.account && a.account.toLowerCase().includes(hl));
    if (!matched) matched = accounts.find(a => a.account && hl.includes(a.account.toLowerCase()));
    if (!matched && hl.includes('@')) {
      const localPart = hl.split('@')[0];
      matched = accounts.find(a => a.account && a.account.toLowerCase().includes(localPart));
    }
    if (!matched) matched = accounts.find(a => a.issuer && a.issuer.toLowerCase().includes(hl));
  }

  // Priority 2: Match by hostname (works for multi-page login like Aliyun)
  if (!matched && hostname) {
    matched = matchByHostname(accounts, hostname);
  }

  // Priority 3: First account (sorted) as fallback
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
      getMatchingAccountCode(message.accountHint, message.hostname)
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
