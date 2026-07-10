import { generateTOTP } from './totp.js';

// --- State ---
let accounts = [];

// --- DOM refs ---
const $ = (id) => document.getElementById(id);
const accountListEl = $('settingsAccountList');
const toast = $('toast');

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadAccounts();
  renderAccountList();

  $('btnBack').addEventListener('click', () => window.close());
  $('btnAddAccount').addEventListener('click', handleAddAccount);
  $('btnExport').addEventListener('click', handleExport);
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', handleImport);

  // Enter key to submit
  $('addSecret').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddAccount();
  });
});

// --- Storage ---
async function loadAccounts() {
  const res = await chrome.runtime.sendMessage({ action: 'getAccounts' });
  accounts = res.accounts || [];
}

async function saveAccounts() {
  await chrome.runtime.sendMessage({ action: 'saveAccounts', accounts });
}

// --- Account List ---
function renderAccountList() {
  if (accounts.length === 0) {
    accountListEl.innerHTML = '<div class="empty-accounts">暂无账号，请手动添加或使用扩展程序扫描二维码</div>';
    return;
  }

  accountListEl.innerHTML = '';
  accounts.forEach((account) => {
    const item = document.createElement('div');
    item.className = 'settings-account-item';
    item.innerHTML = `
      <div class="settings-account-info">
        <div class="settings-account-name">${escapeHtml(account.issuer || '未知')}</div>
        <div class="settings-account-detail">${escapeHtml(account.account || '')}</div>
      </div>
      <div class="settings-account-actions">
        <button class="btn btn-danger" data-id="${account.id}">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          删除
        </button>
      </div>
    `;

    item.querySelector('.btn-danger').addEventListener('click', () => handleDelete(account.id));
    accountListEl.appendChild(item);
  });
}

// --- Add Account ---
async function handleAddAccount() {
  const issuer = $('addIssuer').value.trim();
  const accountName = $('addAccount').value.trim();
  const secret = $('addSecret').value.trim().toUpperCase().replace(/[\s-]/g, '');

  if (!secret) {
    showToast('请输入密钥');
    $('addSecret').focus();
    return;
  }

  // Validate Base32
  if (!/^[A-Z2-7]+=*$/.test(secret)) {
    showToast('密钥格式无效，请输入 Base32 编码的密钥');
    return;
  }

  // Test if the secret can generate a code
  try {
    await generateTOTP(secret);
  } catch {
    showToast('密钥无效，请检查后重试');
    return;
  }

  const newAccount = {
    id: Date.now().toString(),
    issuer: issuer || '未知',
    account: accountName || '',
    secret: secret,
    pinned: false,
    createdAt: Date.now()
  };

  accounts.push(newAccount);
  await saveAccounts();

  $('addIssuer').value = '';
  $('addAccount').value = '';
  $('addSecret').value = '';

  renderAccountList();
  showToast(`已添加: ${issuer || '未知'}`);
}

// --- Delete ---
async function handleDelete(id) {
  if (!confirm('确定要删除此账号吗？此操作不可撤销。')) return;

  accounts = accounts.filter(a => a.id !== id);
  await saveAccounts();
  renderAccountList();
  showToast('已删除');
}

// --- Export ---
async function handleExport() {
  if (accounts.length === 0) {
    showToast('没有可导出的账号');
    return;
  }

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: accounts.map(a => ({
      issuer: a.issuer,
      account: a.account,
      secret: a.secret,
      pinned: a.pinned || false
    }))
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `authenticator-backup-${formatDate()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('已导出');
}

// --- Import ---
async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.accounts || !Array.isArray(data.accounts)) {
      showToast('备份文件格式无效');
      return;
    }

    let imported = 0;
    for (const item of data.accounts) {
      if (item.secret) {
        accounts.push({
          id: Date.now().toString() + Math.random().toString(36).substring(2),
          issuer: item.issuer || '未知',
          account: item.account || '',
          secret: item.secret.toUpperCase().replace(/[\s-]/g, ''),
          pinned: item.pinned || false,
          createdAt: Date.now()
        });
        imported++;
      }
    }

    if (imported > 0) {
      await saveAccounts();
      renderAccountList();
      showToast(`已导入 ${imported} 个账号`);
    } else {
      showToast('未找到有效的账号数据');
    }
  } catch {
    showToast('导入失败，请检查文件格式');
  }

  // Reset file input
  e.target.value = '';
}

// --- Utils ---
function formatDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

let toastTimeout = null;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 1500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
