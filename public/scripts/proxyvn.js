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

function initializeEventListeners() {
    // Refresh account info button
    const refreshBtn = document.getElementById('proxyvn_refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshProxyvnAccount();
        });
    }

    // API Key controls
    setupApiKeyControls();

    // Deposit amount buttons
    setupDepositButtons();

    // Load saved API key on init
    loadSavedApiKey();
}

/**
 * Checks if the ProxyVN panel is currently open
 * @returns {boolean}
 */
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
                        if (currentApiKey) {
                            refreshProxyvnAccount();
                        }
                    }
                }, 300);
            });
        }
    }
}

function setupApiKeyControls() {
    // Get API Key button - mở dashboard
    const getBtn = document.getElementById('get-apikey-btn');
    if (getBtn) {
        getBtn.addEventListener('click', () => {
            openProxyVNDashboard();
        });
    }

    // Edit API Key button
    const editBtn = document.getElementById('edit-apikey-btn');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            editApiKey();
        });
    }

    // Copy API Key button
    const copyBtn = document.getElementById('copy-apikey-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            copyApiKey();
        });
    }

    // Toggle API Key visibility
    const toggleBtn = document.getElementById('toggle-apikey-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            toggleApiKeyVisibility();
        });
    }

    // Clear API Key button
    const clearBtn = document.getElementById('clear-apikey-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('Bạn có chắc muốn xóa API Key?')) {
                clearApiKey();
            }
        });
    }
}

/**
 * Mở trang dashboard ProxyVN.top để user tự lấy API key
 *
 * Cách hoạt động:
 * 1. Mở tab mới vào trang dashboard của ProxyVN.top
 * 2. User đăng nhập (nếu chưa) và copy API key từ dashboard
 * 3. User quay lại tab này và paste API key vào ô input
 * 4. Bấm nút "Edit" để lưu API key
 */
function openProxyVNDashboard() {
    // Mở dashboard ProxyVN.top trong tab mới
    window.open(PROXYVN_DASHBOARD_URL, '_blank');

    // Hiển thị hướng dẫn cho user
    showNotification('Đã mở trang Dashboard ProxyVN.top. Vui lòng copy API Key và dán vào ô bên dưới.', 'info');

    // Tự động focus vào ô API key để user có thể paste ngay
    setTimeout(() => {
        const apiKeyInput = document.getElementById('apikey-value');
        if (apiKeyInput) {
            apiKeyInput.focus();
            // Tự động bật chế độ edit
            editApiKey();
        }
    }, 1000);
}

function editApiKey() {
    const apiKeyInput = document.getElementById('apikey-value');
    const editBtn = document.getElementById('edit-apikey-btn');

    if (apiKeyInput && editBtn) {
        if (apiKeyInput.readOnly) {
            // Bật chế độ chỉnh sửa
            apiKeyInput.readOnly = false;
            apiKeyInput.placeholder = 'Dán API Key từ ProxyVN.top vào đây...';
            apiKeyInput.focus();
            apiKeyInput.select();
            editBtn.innerHTML = '<i class="fa-solid fa-save"></i>';
            editBtn.title = 'Lưu API Key';

            // Lưu khi nhấn Enter
            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    saveManualApiKey();
                    apiKeyInput.removeEventListener('keypress', handleEnter);
                }
            };
            apiKeyInput.addEventListener('keypress', handleEnter);

            // Lưu khi mất focus (user click ra ngoài)
            const handleBlur = () => {
                if (!apiKeyInput.readOnly) {
                    saveManualApiKey();
                    apiKeyInput.removeEventListener('blur', handleBlur);
                }
            };
            apiKeyInput.addEventListener('blur', handleBlur);

        } else {
            // Lưu thay đổi
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
            try {
                saveApiKeyToStorage(newApiKey);
                showNotification('API Key đã được lưu thành công!', 'success');
            } catch (error) {
                console.error('Error saving API key:', error);
                showNotification('Lỗi khi lưu API Key', 'error');
            }
        } else {
            showNotification('Vui lòng nhập API Key hợp lệ', 'warning');
            return; // Không tắt chế độ edit nếu API key không hợp lệ
        }

        // Tắt chế độ chỉnh sửa
        apiKeyInput.readOnly = true;
        apiKeyInput.placeholder = '';
        editBtn.innerHTML = '<i class="fa-solid fa-edit"></i>';
        editBtn.title = 'Chỉnh sửa API Key';
    }
}

/**
 * Lưu API key vào localStorage
 */
function saveApiKeyToStorage(apiKey) {
    try {
        localStorage.setItem(PROXYVN_API_KEY, apiKey);
        currentApiKey = apiKey;
        updateApiKeyDisplay();
        showApiKeyControls();

        // Tự động refresh thông tin tài khoản
        refreshProxyvnAccount();

        console.log('API Key saved to localStorage');
    } catch (error) {
        console.error('Error saving to localStorage:', error);
        throw new Error('Không thể lưu API Key vào localStorage');
    }
}

/**
 * Tải API key đã lưu từ localStorage
 */
function loadSavedApiKey() {
    try {
        const savedApiKey = localStorage.getItem(PROXYVN_API_KEY);

        if (savedApiKey) {
            currentApiKey = savedApiKey;
            updateApiKeyDisplay();
            showApiKeyControls();

            console.log('API Key loaded from localStorage');

            // Tự động refresh nếu panel đang mở
            if (isProxyVNPanelOpen()) {
                refreshProxyvnAccount();
            }
        } else {
            console.log('No saved API Key found');
            hideApiKeyControls();
        }
    } catch (error) {
        console.error('Error loading from localStorage:', error);
    }
}

/**
 * Xóa API key khỏi localStorage
 */
function clearApiKey() {
    try {
        localStorage.removeItem(PROXYVN_API_KEY);
        currentApiKey = null;
        proxyvnAccountData = null;

        // Reset UI
        const apiKeyInput = document.getElementById('apikey-value');
        if (apiKeyInput) {
            apiKeyInput.value = '';
            apiKeyInput.placeholder = 'Vui lòng nhập API Key';
            apiKeyInput.readOnly = true;
        }

        hideApiKeyControls();
        showNoApiKeyState();

        showNotification('API Key đã được xóa', 'info');
    } catch (error) {
        console.error('Error clearing API key:', error);
    }
}

function showApiKeyControls() {
    const buttons = ['edit-apikey-btn', 'copy-apikey-btn', 'toggle-apikey-btn', 'clear-apikey-btn'];
    buttons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = 'inline-block';
    });

    // Thay đổi text và icon của nút Get API Key
    const getBtn = document.getElementById('get-apikey-btn');
    if (getBtn) {
        getBtn.innerHTML = '<i class="fa-solid fa-external-link-alt"></i>';
        getBtn.title = 'Mở Dashboard ProxyVN.top';
    }
}

function hideApiKeyControls() {
    const buttons = ['edit-apikey-btn', 'copy-apikey-btn', 'toggle-apikey-btn', 'clear-apikey-btn'];
    buttons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = 'none';
    });

    // Khôi phục text và icon ban đầu của nút Get API Key
    const getBtn = document.getElementById('get-apikey-btn');
    if (getBtn) {
        getBtn.innerHTML = '<i class="fa-solid fa-key"></i>';
        getBtn.title = 'Lấy API Key từ ProxyVN.top';
    }
}

function copyApiKey() {
    if (currentApiKey) {
        navigator.clipboard.writeText(currentApiKey).then(() => {
            const copyBtn = document.getElementById('copy-apikey-btn');
            if (copyBtn) {
                const originalIcon = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                copyBtn.classList.add('copied');

                setTimeout(() => {
                    copyBtn.innerHTML = originalIcon;
                    copyBtn.classList.remove('copied');
                }, 2000);
            }
            showNotification('API Key đã được copy', 'success');
        }).catch(() => {
            showNotification('Lỗi copy API Key', 'error');
        });
    }
}

function toggleApiKeyVisibility() {
    const apiKeyInput = document.getElementById('apikey-value');
    const toggleBtn = document.getElementById('toggle-apikey-btn');

    if (apiKeyInput && toggleBtn && currentApiKey) {
        apiKeyVisible = !apiKeyVisible;

        if (apiKeyVisible) {
            apiKeyInput.value = currentApiKey;
            toggleBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
            toggleBtn.title = 'Ẩn API Key';
        } else {
            apiKeyInput.value = '●●●●●●●●●●●●●●●●●●●●●●●●●●●●';
            toggleBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
            toggleBtn.title = 'Hiện API Key';
        }
    }
}

function setupDepositButtons() {
    // Quick amount buttons
    document.addEventListener('click', (e) => {
        if (e.target.matches('.amount-btn')) {
            const amount = parseInt(e.target.getAttribute('data-amount'));
            selectAmount(amount);
        }
    });

    // Custom amount input
    const customInput = document.getElementById('custom-amount-input');
    if (customInput) {
        customInput.addEventListener('input', (e) => {
            const amount = parseInt(e.target.value);
            if (amount >= 2000) {
                selectAmount(amount);
            } else {
                hideQRCode();
            }
        });
    }
}

/**
 * Refresh thông tin tài khoản từ ProxyVN API
 * Sử dụng API: https://dev.proxyvn.top/get-api-key-info
 * Authorization: Bearer <API_KEY>
 * Response: {"balance": 21312}
 */
async function refreshProxyvnAccount() {
    if (!currentApiKey) {
        showNoApiKeyState();
        return;
    }

    try {
        showLoadingState();

        // Gọi qua proxy server thay vì trực tiếp
        const response = await fetch('/api/users/proxyvn-balance', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentApiKey}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('API Key không hợp lệ hoặc đã hết hạn');
            } else if (response.status === 403) {
                throw new Error('API Key không có quyền truy cập');
            } else if (response.status === 404) {
                throw new Error('API endpoint không tồn tại');
            } else {
                throw new Error(`HTTP ${response.status}: Lỗi từ server ProxyVN`);
            }
        }

        const data = await response.json();

        // API trả về format: {id: 3, "balance": 21312}
        if (data && typeof data.balance !== 'undefined') {
            proxyvnAccountData = {
                balance: data.balance,
                apiKey: currentApiKey,
                lastUpdated: new Date().toISOString()
            };

            currentUserId = data.id;

            updateProxyvnDisplay();
            console.log('ProxyVN account refreshed:', proxyvnAccountData);

        } else {
            throw new Error('Dữ liệu trả về không đúng format');
        }

    } catch (error) {
        console.error('Error refreshing ProxyVN account:', error);

        if (error.message.includes('API Key không hợp lệ')) {
            // API key không hợp lệ, có thể xóa khỏi storage hoặc để user tự xử lý
            showErrorState('API Key không hợp lệ');
            showNotification('API Key không hợp lệ. Vui lòng kiểm tra lại hoặc lấy API Key mới.', 'error');
        } else if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            showErrorState('Lỗi kết nối');
            showNotification('Không thể kết nối đến server ProxyVN. Vui lòng kiểm tra kết nối mạng.', 'error');
        } else {
            showErrorState(error.message);
            showNotification(`Lỗi: ${error.message}`, 'error');
        }
    }
}

function showNoApiKeyState() {
    const balanceAmount = document.getElementById('proxyvn-balance-amount');
    if (balanceAmount) {
        balanceAmount.textContent = 'Vui lòng nhập API Key';
        balanceAmount.style.color = '#ff9800';
    }
}

function showLoadingState() {
    const balanceAmount = document.getElementById('proxyvn-balance-amount');
    if (balanceAmount) {
        balanceAmount.textContent = 'Đang tải...';
        balanceAmount.style.color = '#666';
    }
}

function showErrorState(message = 'Lỗi') {
    const balanceAmount = document.getElementById('proxyvn-balance-amount');
    if (balanceAmount) {
        balanceAmount.textContent = message;
        balanceAmount.style.color = '#f44336';
    }
}

function updateProxyvnDisplay() {
    if (!proxyvnAccountData) return;

    updateBalanceDisplay();
    updateApiKeyDisplay();
}

function updateApiKeyDisplay() {
    const apiKeyInput = document.getElementById('apikey-value');

    if (apiKeyInput && currentApiKey) {
        apiKeyInput.readOnly = true;
        if (apiKeyVisible) {
            apiKeyInput.value = currentApiKey;
        } else {
            apiKeyInput.value = '●●●●●●●●●●●●●●●●●●●●●●●●●●●●';
        }
        apiKeyInput.placeholder = '';
    }
}

function updateBalanceDisplay() {
    const balanceAmount = document.getElementById('proxyvn-balance-amount');
    if (balanceAmount && proxyvnAccountData.balance !== undefined) {
        const balance = parseFloat(proxyvnAccountData.balance);
        balanceAmount.textContent = balance.toLocaleString('vi-VN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
        balanceAmount.style.color = '#4CAF50';
    }
}

function selectAmount(amount) {
    selectedAmount = amount;

    document.querySelectorAll('.amount-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (parseInt(btn.getAttribute('data-amount')) === amount) {
            btn.classList.add('selected');
        }
    });

    const customInput = document.getElementById('custom-amount-input');
    if (customInput) {
        customInput.value = amount;
    }

    showQRCode(amount);
}

function showQRCode(amount) {

    const qrSection = document.getElementById('qr-section');
    const qrImage = document.getElementById('qrCodeImage');
    const displayAmount = document.getElementById('qr-display-amount');

    if (qrSection && qrImage && displayAmount && currentUserId) {
        // Generate QR URL với API key làm identifier để ProxyVN biết nạp cho ai
        const baseQRUrl = 'https://img.vietqr.io/image/VPB-proxyai-qr_only.png';
        const addInfo = `proxyai ${currentUserId}`;
        const accountName = 'Pham%20Quang%20Loc';

        const qrUrl = `${baseQRUrl}?amount=${amount}&addInfo=${encodeURIComponent(addInfo)}&accountName=${accountName}`;

        qrImage.src = qrUrl;
        displayAmount.textContent = `${amount.toLocaleString('vi-VN')}đ`;
        qrSection.style.display = 'block';

        qrSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function hideQRCode() {
    const qrSection = document.getElementById('qr-section');
    if (qrSection) {
        qrSection.style.display = 'none';
    }
    selectedAmount = 0;

    document.querySelectorAll('.amount-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
}

// Export functions cho external use
export async function getProxyvnBalance() {
    if (!currentApiKey) return 0;

    try {
        const response = await fetch(`${PROXYVN_API_BASE}/get-api-key-info`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentApiKey}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            return data && typeof data.balance !== 'undefined' ? parseFloat(data.balance || 0) : 0;
        }
    } catch (error) {
        console.error('Error fetching ProxyVN balance:', error);
    }
    return 0;
}

function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);

    if (typeof toastr !== 'undefined') {
        toastr[type](message);
    } else {
        // Fallback notification nếu không có toastr
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : type === 'warning' ? '#ff9800' : '#2196f3'};
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            z-index: 10000;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            font-family: Arial, sans-serif;
            font-size: 14px;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

export function initProxyvnPanel() {
    initializeEventListeners();
    setupAutoRefresh();
    console.log('ProxyVN panel initialized');
}
