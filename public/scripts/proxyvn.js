// public/scripts/proxyvn.js

// --- BIẾN TOÀN CỤC ---
let proxyvnAccountData = null;
let apiKeyVisible = false;
let selectedAmount = 0;
let currentApiKey = null;
let currentUserId = null;

// LocalStorage keys
const PROXYVN_API_KEY = 'proxyvn_api_key';

// API endpoints
const PROXYVN_API_BASE = 'https://proxyvn.top';
const PROXYVN_DASHBOARD_URL = 'https://proxyvn.top/dashboard';

// --- PHẦN KHỞI TẠO ---
export function initProxyvnPanel() {
    initializeEventListeners();
    setupAutoRefresh();
    setupRemoteTunnel(); // <--- [MỚI] Khởi tạo Remote Tunnel
    console.log('ProxyVN panel initialized');
}

function initializeEventListeners() {
    const refreshBtn = document.getElementById('proxyvn_refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshProxyvnAccount);

    setupApiKeyControls();
    setupDepositButtons();
    loadSavedApiKey();
}

export function isProxyVNPanelOpen() {
    return document.querySelector('#proxyvn-button .drawer-content')?.classList.contains('openDrawer') ?? false;
}

function setupAutoRefresh() {
    const proxyvnDrawer = document.getElementById('proxyvn-button');
    if (proxyvnDrawer) {
        const drawerToggle = proxyvnDrawer.querySelector('.drawer-toggle');
        if (drawerToggle) {
            drawerToggle.addEventListener('click', () => {
                setTimeout(() => {
                    const content = document.getElementById('proxyvn-content');
                    if (content && !content.classList.contains('closedDrawer')) {
                        if (currentApiKey) refreshProxyvnAccount();
                        checkRemoteStatus(); // <--- [MỚI] Check trạng thái Tunnel mỗi khi mở panel
                    }
                }, 300);
            });
        }
    }
}

// =============================================================================
// [MỚI] LOGIC XỬ LÝ REMOTE TUNNEL (CLOUDFLARE)
// =============================================================================

const pvnUi = {
    user: () => document.getElementById('pvn-r-user'),
    pass: () => document.getElementById('pvn-r-pass'),
    link: () => document.getElementById('pvn-r-link'),
    configArea: () => document.getElementById('pvn-remote-config'),
    statusArea: () => document.getElementById('pvn-remote-status'),
    btn: () => document.getElementById('pvn-btn-toggle'),
    indicator: () => document.getElementById('pvn-online-indicator')
};

function setupRemoteTunnel() {
    // 1. Nút Bật/Tắt
    const btn = document.getElementById('pvn-btn-toggle');
    if (btn) btn.addEventListener('click', pvnToggleRemote);

    // 2. Nút Copy (Icon)
    const copyBtn = document.getElementById('pvn-copy-link-btn');
    if(copyBtn) copyBtn.addEventListener('click', pvnCopyLink);

    // 3. Nút Mở Link Tab Mới
    const openBtn = document.getElementById('pvn-open-link-btn');
    if(openBtn) openBtn.addEventListener('click', pvnOpenLink);

    // 4. [FIX] Click trực tiếp vào ô Link cũng tự Copy luôn
    const linkInput = document.getElementById('pvn-r-link');
    if (linkInput) {
        // Xóa hành động mặc định cũ nếu có và gán hàm copy
        linkInput.addEventListener('click', () => {
            pvnCopyLink();
        });
    }

    checkRemoteStatus();
}

async function checkRemoteStatus() {
    try {
        const res = await fetch('/api/remote/status', { method: 'POST' });
        const data = await res.json();

        const userEl = pvnUi.user();
        const passEl = pvnUi.pass();

        // Điền user/pass đã lưu (nếu có)
        if(data.savedUser && userEl) userEl.value = data.savedUser;
        if(data.savedPass && passEl) passEl.value = data.savedPass;

        if(data.running) {
            pvnShowRunning(data.url);
        } else {
            pvnShowStopped();
        }
    } catch(e) {
        console.error("ProxyVN Remote Error:", e);
    }
}

async function pvnToggleRemote() {
    const statusArea = pvnUi.statusArea();
    const isRunning = statusArea && statusArea.style.display !== 'none';

    const userEl = pvnUi.user();
    const passEl = pvnUi.pass();
    const btn = pvnUi.btn();

    const user = userEl ? userEl.value.trim() : '';
    const pass = passEl ? passEl.value.trim() : '';

    if (!isRunning) {
        // BẬT ONLINE
        if(!user || !pass) {
            showNotification("Vui lòng nhập Tên đăng nhập và Mật khẩu để bảo mật!", "warning");
            if(userEl && !user) userEl.focus();
            else if(passEl) passEl.focus();
            return;
        }

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang khởi động...';
        btn.disabled = true;

        try {
            const res = await fetch('/api/remote/toggle', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ action: 'start', user, pass })
            });
            const data = await res.json();

            if (data.url) {
                pvnShowRunning(data.url);
                showNotification("Đã bật Online thành công! Hãy copy link và truy cập từ các thiết bị mà bạn muốn.", "success");
            } else {
                // Retry sau 2s
                setTimeout(checkRemoteStatus, 2000);
            }
        } catch(e) {
            showNotification("Lỗi kết nối: " + e.message, "error");
            pvnShowStopped();
        }
    } else {
        // TẮT ONLINE
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tắt...';
        btn.disabled = true;
        try {
            await fetch('/api/remote/toggle', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ action: 'stop' })
            });
            pvnShowStopped();
            showNotification("Đã tắt truy cập từ xa.", "info");
        } catch(e) { pvnShowStopped(); }
    }
}

function pvnShowRunning(url) {
    const config = pvnUi.configArea();
    const status = pvnUi.statusArea();
    const link = pvnUi.link();
    const btn = pvnUi.btn();

    // 1. Cập nhật Badge Status
    const badge = document.getElementById('pvn-status-badge');
    if(badge) {
        badge.className = 'status-badge online';
        badge.querySelector('.status-text').innerText = 'ONLINE';
    }

    // 2. Ẩn config, Hiện status
    if(config) config.style.display = 'none';
    if(status) status.style.display = 'block';

    // 3. Xử lý Link
    if(link) link.value = url || "Đang lấy link...";

    // 4. TẠO QR CODE (Sử dụng API public nhanh gọn)
    const qrImg = document.getElementById('pvn-qr-img');
    if(qrImg && url) {
        // Tạo QR code trỏ về link Cloudflare
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}`;
    }

    // 5. Cập nhật nút TẮT
    if(btn) {
        btn.innerHTML = '<i class="fa-solid fa-power-off"></i> TẮT KẾT NỐI';
        btn.style.background = '#e74c3c'; // Màu đỏ
        btn.disabled = false;
    }
}

function pvnShowStopped() {
    const config = pvnUi.configArea();
    const status = pvnUi.statusArea();
    const btn = pvnUi.btn();

    // 1. Cập nhật Badge Status
    const badge = document.getElementById('pvn-status-badge');
    if(badge) {
        badge.className = 'status-badge offline';
        badge.querySelector('.status-text').innerText = 'OFFLINE';
    }

    // 2. Hiện config, Ẩn status
    if(config) config.style.display = 'block';
    if(status) status.style.display = 'none';

    // 3. Reset nút BẬT
    if(btn) {
        btn.innerHTML = '<i class="fa-solid fa-rocket"></i> BẬT ONLINE';
        // Gradient Xanh Dương -> Xanh Lá
        btn.style.background = 'linear-gradient(90deg, #4E73DF, #1CC88A)';
        btn.disabled = false;
    }
}

function pvnCopyLink() {
    const copyText = pvnUi.link();
    if(copyText && copyText.value) {
        // 1. Bôi đen text (Hiệu ứng thị giác)
        copyText.select();
        copyText.setSelectionRange(0, 99999); // Hỗ trợ mobile

        // 2. Thực hiện Copy
        navigator.clipboard.writeText(copyText.value).then(() => {
            showNotification("Đã copy link vào bộ nhớ tạm!", "success");
        }).catch(err => {
            // Fallback nếu trình duyệt chặn
            console.error('Copy failed', err);
            document.execCommand('copy'); // Cách cũ
            showNotification("Đã copy link!", "success");
        });
    }
}

function pvnOpenLink() {
    const linkEl = pvnUi.link();
    if(linkEl && linkEl.value && linkEl.value.startsWith('http')) {
        window.open(linkEl.value, '_blank');
    } else {
        showNotification("Chưa có link để mở", "warning");
    }
}

// =============================================================================
// CÁC HÀM CŨ (API Key, Nạp tiền...) - GIỮ NGUYÊN LOGIC, CHỈ CẦN FORMAT LẠI
// =============================================================================

function setupApiKeyControls() {
    const getBtn = document.getElementById('get-apikey-btn');
    if (getBtn) getBtn.addEventListener('click', openProxyVNDashboard);

    const editBtn = document.getElementById('edit-apikey-btn');
    if (editBtn) editBtn.addEventListener('click', editApiKey);

    const copyBtn = document.getElementById('copy-apikey-btn');
    if (copyBtn) copyBtn.addEventListener('click', copyApiKey);

    const toggleBtn = document.getElementById('toggle-apikey-btn');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleApiKeyVisibility);

    const clearBtn = document.getElementById('clear-apikey-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        if (confirm('Bạn có chắc muốn xóa API Key?')) clearApiKey();
    });
}

function openProxyVNDashboard() {
    window.open(PROXYVN_DASHBOARD_URL, '_blank');
    showNotification('Đã mở Dashboard. Copy API Key và dán vào đây.', 'info');
    setTimeout(() => {
        const apiKeyInput = document.getElementById('apikey-value');
        if (apiKeyInput) {
            apiKeyInput.focus();
            editApiKey();
        }
    }, 1000);
}

function editApiKey() {
    const apiKeyInput = document.getElementById('apikey-value');
    const editBtn = document.getElementById('edit-apikey-btn');

    if (apiKeyInput && editBtn) {
        if (apiKeyInput.readOnly) {
            apiKeyInput.readOnly = false;
            apiKeyInput.placeholder = 'Dán API Key vào đây...';
            apiKeyInput.focus();
            apiKeyInput.select();
            editBtn.innerHTML = '<i class="fa-solid fa-save"></i>';
            editBtn.title = 'Lưu API Key';

            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    saveManualApiKey();
                    apiKeyInput.removeEventListener('keypress', handleEnter);
                }
            };
            apiKeyInput.addEventListener('keypress', handleEnter);

            // Không auto-save on blur để tránh phiền phức
        } else {
            saveManualApiKey();
        }
    }
}

function saveManualApiKey() {
    const apiKeyInput = document.getElementById('apikey-value');
    const editBtn = document.getElementById('edit-apikey-btn');

    if (apiKeyInput && editBtn) {
        const newApiKey = apiKeyInput.value.trim();
        if (newApiKey && newApiKey !== '●●●●●●●●●●●●●●●●●●●●●●●●●●●●') {
            saveApiKeyToStorage(newApiKey);
            showNotification('API Key đã được lưu!', 'success');
        } else {
            showNotification('API Key không hợp lệ', 'warning');
            return;
        }
        apiKeyInput.readOnly = true;
        apiKeyInput.placeholder = '';
        editBtn.innerHTML = '<i class="fa-solid fa-edit"></i>';
        editBtn.title = 'Chỉnh sửa API Key';
    }
}

function saveApiKeyToStorage(apiKey) {
    localStorage.setItem(PROXYVN_API_KEY, apiKey);
    currentApiKey = apiKey;
    updateApiKeyDisplay();
    showApiKeyControls();
    refreshProxyvnAccount();
}

function loadSavedApiKey() {
    const savedApiKey = localStorage.getItem(PROXYVN_API_KEY);
    if (savedApiKey) {
        currentApiKey = savedApiKey;
        updateApiKeyDisplay();
        showApiKeyControls();
        if (isProxyVNPanelOpen()) refreshProxyvnAccount();
    } else {
        hideApiKeyControls();
    }
}

function clearApiKey() {
    localStorage.removeItem(PROXYVN_API_KEY);
    currentApiKey = null;
    proxyvnAccountData = null;
    const apiKeyInput = document.getElementById('apikey-value');
    if (apiKeyInput) {
        apiKeyInput.value = '';
        apiKeyInput.placeholder = 'Vui lòng nhập API Key';
        apiKeyInput.readOnly = true;
    }
    hideApiKeyControls();
    showNoApiKeyState();
    showNotification('Đã xóa API Key', 'info');
}

function showApiKeyControls() {
    ['edit-apikey-btn', 'copy-apikey-btn', 'toggle-apikey-btn', 'clear-apikey-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = 'inline-block';
    });
    const getBtn = document.getElementById('get-apikey-btn');
    if (getBtn) {
        getBtn.innerHTML = '<i class="fa-solid fa-external-link-alt"></i>';
        getBtn.title = 'Mở Dashboard';
    }
}

function hideApiKeyControls() {
    ['edit-apikey-btn', 'copy-apikey-btn', 'toggle-apikey-btn', 'clear-apikey-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = 'none';
    });
    const getBtn = document.getElementById('get-apikey-btn');
    if (getBtn) {
        getBtn.innerHTML = '<i class="fa-solid fa-key"></i>';
        getBtn.title = 'Lấy API Key';
    }
}

function copyApiKey() {
    if (currentApiKey) {
        navigator.clipboard.writeText(currentApiKey).then(() => {
            showNotification('API Key đã được copy', 'success');
        });
    }
}

function toggleApiKeyVisibility() {
    const apiKeyInput = document.getElementById('apikey-value');
    const toggleBtn = document.getElementById('toggle-apikey-btn');
    if (apiKeyInput && toggleBtn && currentApiKey) {
        apiKeyVisible = !apiKeyVisible;
        apiKeyInput.value = apiKeyVisible ? currentApiKey : '●●●●●●●●●●●●●●●●●●●●●●●●●●●●';
        toggleBtn.innerHTML = apiKeyVisible ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    }
}

function setupDepositButtons() {
    document.addEventListener('click', (e) => {
        if (e.target.matches('.amount-btn')) selectAmount(parseInt(e.target.getAttribute('data-amount')));
    });
    const customInput = document.getElementById('custom-amount-input');
    if (customInput) {
        customInput.addEventListener('input', (e) => {
            const amount = parseInt(e.target.value);
            amount >= 2000 ? selectAmount(amount) : hideQRCode();
        });
    }
}

async function refreshProxyvnAccount() {
    if (!currentApiKey) { showNoApiKeyState(); return; }
    try {
        showLoadingState();
        const response = await fetch('/api/users/proxyvn-balance', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentApiKey}` }
        });
        if (!response.ok) throw new Error(response.status === 401 ? 'API Key hết hạn' : 'Lỗi kết nối');
        const data = await response.json();
        if (data && typeof data.balance !== 'undefined') {
            proxyvnAccountData = { balance: data.balance, apiKey: currentApiKey };
            currentUserId = data.id;
            updateProxyvnDisplay();
        }
    } catch (error) {
        showErrorState(error.message);
    }
}

function showNoApiKeyState() {
    const el = document.getElementById('proxyvn-balance-amount');
    if (el) { el.textContent = 'Vui lòng nhập API Key'; el.style.color = '#ff9800'; }
}
function showLoadingState() {
    const el = document.getElementById('proxyvn-balance-amount');
    if (el) { el.textContent = 'Đang tải...'; el.style.color = '#666'; }
}
function showErrorState(msg) {
    const el = document.getElementById('proxyvn-balance-amount');
    if (el) { el.textContent = msg; el.style.color = '#f44336'; }
}
function updateProxyvnDisplay() {
    if (proxyvnAccountData) {
        const el = document.getElementById('proxyvn-balance-amount');
        if (el) {
            el.textContent = parseFloat(proxyvnAccountData.balance).toLocaleString('vi-VN');
            el.style.color = '#4CAF50';
        }
        updateApiKeyDisplay();
    }
}
function updateApiKeyDisplay() {
    const el = document.getElementById('apikey-value');
    if (el && currentApiKey) {
        el.readOnly = true;
        el.value = apiKeyVisible ? currentApiKey : '●●●●●●●●●●●●●●●●●●●●●●●●●●●●';
    }
}

function selectAmount(amount) {
    selectedAmount = amount;
    document.querySelectorAll('.amount-btn').forEach(btn => {
        btn.classList.toggle('selected', parseInt(btn.getAttribute('data-amount')) === amount);
    });
    const customInput = document.getElementById('custom-amount-input');
    if (customInput) customInput.value = amount;
    showQRCode(amount);
}

function showQRCode(amount) {
    const qrSection = document.getElementById('qr-section');
    const qrImage = document.getElementById('qrCodeImage');
    const displayAmount = document.getElementById('qr-display-amount');
    if (qrSection && qrImage && displayAmount && currentUserId) {
        const baseQRUrl = 'https://img.vietqr.io/image/VPB-proxyai-qr_only.png';
        const addInfo = `proxyai ${currentUserId}`;
        qrImage.src = `${baseQRUrl}?amount=${amount}&addInfo=${encodeURIComponent(addInfo)}&accountName=Pham%20Quang%20Loc`;
        displayAmount.textContent = `${amount.toLocaleString('vi-VN')}đ`;
        qrSection.style.display = 'block';
        qrSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
function hideQRCode() {
    const qrSection = document.getElementById('qr-section');
    if (qrSection) qrSection.style.display = 'none';
    selectedAmount = 0;
    document.querySelectorAll('.amount-btn').forEach(btn => btn.classList.remove('selected'));
}

export async function getProxyvnBalance() {
    if (!currentApiKey) return 0;
    try {
        const res = await fetch(`${PROXYVN_API_BASE}/get-api-key-info`, {
            headers: { 'Authorization': `Bearer ${currentApiKey}` }
        });
        if (res.ok) {
            const data = await res.json();
            return data.balance ? parseFloat(data.balance) : 0;
        }
    } catch (e) {}
    return 0;
}

function showNotification(message, type = 'info') {
    if (typeof toastr !== 'undefined') {
        toastr[type](message);
    } else {
        console.log(`[${type}] ${message}`);
    }
}
