const pageType = document.body.dataset.page || 'login';
const authKey = 'sulzenAuth';
let ethChart;
let currentPrice = 0;
let currentUser = null;
let supportsBrabills = true;
let supportsBardens = true;
const BARDEN_PRICE_BR = 10;
const MAX_HISTORY_POINTS = 20;
const POINT_WIDTH = 90;
const priceHistory = [];
const timeLabels = [];

const client = supabase.createClient(
    'https://xvnpjnsyuhfueuhfwluh.supabase.co',
    'sb_publishable_fizNa4x-4gDqQd_mW0R3xg_-0YtrV7P'
);

function getEl(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const el = getEl(id);
    if (el) el.textContent = value;
}

function setHTML(id, value) {
    const el = getEl(id);
    if (el) el.innerHTML = value;
}

function show(id) {
    const el = getEl(id);
    if (el) el.classList.remove('hidden');
}

function hide(id) {
    const el = getEl(id);
    if (el) el.classList.add('hidden');
}

function formatMoney(value) {
    return `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function toDatabaseNumber(value) {
    const normalized = Number(value || 0);
    if (!Number.isFinite(normalized)) return 0;
    return Number(normalized.toFixed(8));
}

function updateBrToBbPreview() {
    const amount = Number(getEl('convert-br-input')?.value);
    const output = getEl('convert-bb-output');
    if (!output) return;

    if (!amount || amount <= 0 || !currentPrice || currentPrice <= 0) {
        output.value = '';
        return;
    }

    output.value = toDatabaseNumber(amount * currentPrice);
}

function updateBbToBrPreview() {
    const amount = Number(getEl('convert-bb-input')?.value);
    const output = getEl('convert-br-output');
    if (!output) return;

    if (!amount || amount <= 0 || !currentPrice || currentPrice <= 0) {
        output.value = '';
        return;
    }

    output.value = toDatabaseNumber(amount / currentPrice);
}

async function convertBrToBb() {
    if (!currentUser) return alert('Login first.');
    if (!supportsBrabills) return alert('Trading requires the brabills_balance column in the profiles table.');
    if (!currentPrice || currentPrice <= 0) return alert('Waiting for live ETH price.');

    const brokenAmount = Number(getEl('convert-br-input')?.value);
    if (!brokenAmount || brokenAmount <= 0) return alert('Enter a positive BR amount.');

    const brabillsAmount = toDatabaseNumber(brokenAmount * currentPrice);
    const brokenBalance = Number(currentUser.broken_balance || 0);

    if (brokenAmount > brokenBalance) {
        return alert('Not enough BR to convert.');
    }

    const updated = {
        broken_balance: toDatabaseNumber(brokenBalance - brokenAmount),
        brabills_balance: toDatabaseNumber(Number(currentUser.brabills_balance || 0) + brabillsAmount)
    };

    if (!(await saveCurrentUser(updated))) return;

    updatePortfolioDisplay();
    alert(`Converted ${formatNumber(brokenAmount)} BR into ${formatNumber(brabillsAmount)} BB.`);
}

async function convertBbToBr() {
    if (!currentUser) return alert('Login first.');
    if (!supportsBrabills) return alert('Trading requires the brabills_balance column in the profiles table.');
    if (!currentPrice || currentPrice <= 0) return alert('Waiting for live ETH price.');

    const bbAmount = Number(getEl('convert-bb-input')?.value);
    if (!bbAmount || bbAmount <= 0) return alert('Enter a positive BB amount.');

    const brokenAmount = toDatabaseNumber(bbAmount / currentPrice);
    const brabillsBalance = Number(currentUser.brabills_balance || 0);

    if (bbAmount > brabillsBalance) {
        return alert('Not enough BB to convert.');
    }

    const updated = {
        brabills_balance: toDatabaseNumber(brabillsBalance - bbAmount),
        broken_balance: toDatabaseNumber(Number(currentUser.broken_balance || 0) + brokenAmount)
    };

    if (!(await saveCurrentUser(updated))) return;

    updatePortfolioDisplay();
    alert(`Converted ${formatNumber(bbAmount)} BB into ${formatNumber(brokenAmount)} BR.`);
}

function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function hashPassword(password) {
    const enc = new TextEncoder();
    const data = enc.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getSession() {
    try {
        return JSON.parse(localStorage.getItem(authKey));
    } catch (error) {
        return null;
    }
}

function saveSession(session) {
    localStorage.setItem(authKey, JSON.stringify(session));
}

function clearSession() {
    localStorage.removeItem(authKey);
}

async function detectAssetColumns() {
    const info = getEl('account-info');
    const missing = [];

    supportsBrabills = true;
    supportsBardens = true;

    try {
        const { error } = await client
            .from('profiles')
            .select('brabills_balance')
            .limit(1)
            .maybeSingle();
        if (error) {
            supportsBrabills = false;
            missing.push('Brabills');
            console.warn('Brabills field missing in profiles table:', error.message);
        }
    } catch (error) {
        supportsBrabills = false;
        missing.push('Brabills');
        console.warn('Unable to detect brabills_balance field:', error);
    }

    try {
        const { error } = await client
            .from('profiles')
            .select('barden_balance')
            .limit(1)
            .maybeSingle();
        if (error) {
            supportsBardens = false;
            missing.push('Bardens');
            console.warn('Barden field missing in profiles table:', error.message);
        }
    } catch (error) {
        supportsBardens = false;
        missing.push('Bardens');
        console.warn('Unable to detect barden_balance field:', error);
    }

    if (info) {
        if (missing.length === 0) {
            info.textContent = 'Manage your fake crypto and climb the leaderboard.';
        } else {
            info.textContent = `${missing.join(' and ')} data is unavailable. Some trading features are disabled until the table is updated.`;
        }
    }
}

function setChartWidth() {
    const canvas = getEl('ethChart');
    if (!canvas) return;
    const width = Math.max(960, priceHistory.length * POINT_WIDTH);
    canvas.width = width;
    canvas.style.width = width + 'px';
}

function initChart() {
    const ctx = getEl('ethChart')?.getContext('2d');
    if (!ctx) return;

    setChartWidth();

    ethChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: 'ETH Price',
                data: priceHistory,
                borderColor: '#64ffda',
                backgroundColor: 'rgba(100,255,218,0.12)',
                borderWidth: 2,
                tension: 0.35,
                pointRadius: 0,
                fill: true
            }]
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            scales: {
                x: {
                    display: false,
                    grid: { display: false }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.08)' },
                    ticks: { color: '#9fc7b4' }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

async function updatePrice() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const data = await response.json();
        const price = data?.ethereum?.usd;
        if (!price || typeof price !== 'number') throw new Error('Invalid price data');

        currentPrice = price;
        const now = new Date();

        setText('eth-price', formatMoney(price));
        setText('eth-price-small', formatMoney(price));
        setText('last-update', now.toLocaleTimeString());

        priceHistory.push(price);
        timeLabels.push(now.toLocaleTimeString());
        if (priceHistory.length > MAX_HISTORY_POINTS) {
            priceHistory.shift();
            timeLabels.shift();
        }

        setChartWidth();
        ethChart?.update('none');
        if (currentUser) {
            updatePortfolioDisplay();
            refreshLeaderboard();
        }
    } catch (error) {
        console.warn('Price refresh failed:', error);
    }
}

async function refreshLeaderboard() {
    let selection = 'username,broken_balance';
    if (supportsBrabills) selection += ',brabills_balance';
    if (supportsBardens) selection += ',barden_balance';
    const { data, error } = await client
        .from('profiles')
        .select(selection)
        .limit(100);

    if (error) {
        setHTML('leaderboard', '<div class="note">Unable to load leaderboard.</div>');
        console.error('Leaderboard load error', error);
        return;
    }

    const rows = (data || []).map((profile) => {
        const broken = Number(profile.broken_balance || 0);
        const brabills = supportsBrabills ? Number(profile.brabills_balance || 0) : 0;
        const bardens = supportsBardens ? Number(profile.barden_balance || 0) : 0;
        const brokenUsd = broken * currentPrice;
        const bardenUsd = bardens * BARDEN_PRICE_BR * currentPrice;
        return {
            username: profile.username,
            broken,
            brabills,
            bardens,
            total: brokenUsd + brabills + bardenUsd
        };
    });

    rows.sort((a, b) => b.total - a.total);
    setText('leaderboard-count', `${rows.length} players`);

    if (rows.length === 0) {
        setHTML('leaderboard', '<div class="note">No players yet. Be the first to trade!</div>');
        return;
    }

    setHTML('leaderboard', rows.map((profile, index) => `
        <div class="leader-row">
            <span class="rank">${index + 1}</span>
            <span class="name">${escapeHtml(profile.username)}</span>
            <span class="value">${formatMoney(profile.total)}</span>
        </div>
    `).join(''));
}

function updatePortfolioDisplay() {
    if (!currentUser) return;
    const broken = Number(currentUser.broken_balance || 0);
    const brabills = Number(currentUser.brabills_balance || 0);
    const bardens = Number(currentUser.barden_balance || 0);
    const brokenUsd = broken * currentPrice;
    const bardenUsd = bardens * BARDEN_PRICE_BR * currentPrice;
    const totalValue = brokenUsd + brabills + bardenUsd;

    setText('broken-balance', `${formatNumber(broken)} BR`);
    setText('brabills-balance', `${formatNumber(brabills)} BB`);
    setText('barden-balance', `${formatNumber(bardens)} BD`);
    setText('total-value', formatMoney(totalValue));
    setText('portfolio-value', formatMoney(totalValue));
}

function normalizeUpdateNumbers(update) {
    const normalized = { ...update };
    Object.keys(normalized).forEach((key) => {
        if (typeof normalized[key] === 'number' && Number.isFinite(normalized[key])) {
            normalized[key] = Number(normalized[key].toFixed(8));
        }
    });
    return normalized;
}

async function saveCurrentUser(update) {
    const payload = normalizeUpdateNumbers(update);
    const { data, error } = await client
        .from('profiles')
        .update(payload)
        .eq('id', currentUser.id)
        .select()
        .maybeSingle();

    if (error) {
        let message = error.message || 'Unknown error';
        if (message.includes('type bigint')) {
            message = `${message}. Check your Supabase profile columns and make sure balances like broken_balance, brabills_balance, and barden_balance use numeric types, not bigint.`;
        }
        alert(`Unable to save account: ${message}`);
        console.error('Save error', error);
        return false;
    }

    currentUser = { ...currentUser, ...data };
    return true;
}

async function login() {
    const username = getEl('username-input')?.value.trim();
    const password = getEl('password-input')?.value;

    if (!username || !password) {
        return alert('Enter your username and password.');
    }

    const passwordHash = await hashPassword(password);
    const { data: user, error } = await client
        .from('profiles')
        .select('*')
        .eq('username', username)
        .maybeSingle();

    if (error) {
        console.error('Login query error', error);
        return alert('Login error, try again.');
    }

    if (!user) {
        const payload = {
            username,
            password: passwordHash,
            broken_balance: 15
        };
        if (supportsBrabills) payload.brabills_balance = 0;
        if (supportsBardens) payload.barden_balance = 0;

        const { data: newUser, error: createError } = await client
            .from('profiles')
            .insert([payload])
            .select()
            .maybeSingle();

        if (createError) {
            console.error('Create user error', createError);
            return alert('Unable to create account.');
        }

        currentUser = newUser;
        if (currentUser.brabills_balance === undefined) {
            currentUser.brabills_balance = 0;
        }
        if (currentUser.barden_balance === undefined) {
            currentUser.barden_balance = 0;
        }
        saveSession({ username, passwordHash, plainPassword: password });
        window.location.href = 'dashboard.html';
        return;
    }

    const passwordMatchesHash = user.password === passwordHash;
    const passwordMatchesPlain = user.password === password;

    if (!passwordMatchesHash && !passwordMatchesPlain) {
        return alert('Password incorrect.');
    }

    currentUser = user;
    if (passwordMatchesPlain) {
        const { error: upgradeError } = await client
            .from('profiles')
            .update({ password: passwordHash })
            .eq('id', user.id);

        if (upgradeError) {
            console.warn('Password upgrade failed:', upgradeError.message);
        }
    }

    if (currentUser.brabills_balance === undefined) {
        currentUser.brabills_balance = 0;
    }
    if (currentUser.barden_balance === undefined) {
        currentUser.barden_balance = 0;
    }
    saveSession({ username, passwordHash, plainPassword: password });
    window.location.href = 'dashboard.html';
}

async function restoreSession(session) {
    if (!session?.username) return false;

    const { data: user, error } = await client
        .from('profiles')
        .select('*')
        .eq('username', session.username)
        .maybeSingle();

    if (error || !user) {
        clearSession();
        window.location.href = 'index.html';
        return false;
    }

    const passwordMatchesHash = user.password === session.passwordHash;
    const passwordMatchesPlain = user.password === session.plainPassword;

    if (!passwordMatchesHash && !passwordMatchesPlain) {
        clearSession();
        window.location.href = 'index.html';
        return false;
    }

    currentUser = user;
    if (passwordMatchesPlain) {
        const { error: upgradeError } = await client
            .from('profiles')
            .update({ password: session.passwordHash })
            .eq('id', user.id);

        if (!upgradeError) {
            currentUser.password = session.passwordHash;
        }
    }

    if (currentUser.brabills_balance === undefined) {
        currentUser.brabills_balance = 0;
    }
    if (currentUser.barden_balance === undefined) {
        currentUser.barden_balance = 0;
    }
    if (currentUser.broken_balance === undefined) {
        currentUser.broken_balance = 0;
    }

    return true;
}

async function loadDashboard() {
    const session = getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    initChart();
    await updatePrice();
    await detectAssetColumns();

    if (!(await restoreSession(session))) {
        return;
    }

    setText('welcome-msg', `Vault: ${escapeHtml(currentUser.username)}`);
    setText('barden-price', `${BARDEN_PRICE_BR} BR`);
    updatePortfolioDisplay();
    refreshLeaderboard();
    setInterval(updatePrice, 30000);
}

async function executeBuyBarden(amount) {
    const cost = toDatabaseNumber(amount * BARDEN_PRICE_BR);
    const brokenBalance = Number(currentUser.broken_balance || 0);
    if (cost > brokenBalance) {
        return alert('Not enough BR to buy that amount of Bardens.');
    }

    const updated = {
        broken_balance: toDatabaseNumber(brokenBalance - cost),
        barden_balance: toDatabaseNumber(Number(currentUser.barden_balance || 0) + amount)
    };

    if (!(await saveCurrentUser(updated))) return;

    updatePortfolioDisplay();
    alert(`Bought ${formatNumber(amount)} BD for ${formatMoney(cost)} BR.`);
}

async function executeSellBarden(amount) {
    const bardenBalance = Number(currentUser.barden_balance || 0);
    if (amount > bardenBalance) {
        return alert('Not enough Bardens to sell that amount.');
    }

    const proceeds = toDatabaseNumber(amount * BARDEN_PRICE_BR);
    const updated = {
        barden_balance: toDatabaseNumber(bardenBalance - amount),
        broken_balance: toDatabaseNumber(Number(currentUser.broken_balance || 0) + proceeds)
    };

    if (!(await saveCurrentUser(updated))) return;

    updatePortfolioDisplay();
    alert(`Sold ${formatNumber(amount)} BD for ${formatMoney(proceeds)} BR.`);
}

async function previewBuyBarden() {
    if (!currentUser) return alert('Login first.');
    if (!supportsBardens) return alert('Trading requires the barden_balance column in the profiles table.');

    const amount = Number(getEl('trade-amount-barden')?.value);
    if (!amount || amount <= 0) return alert('Enter a positive BD amount.');

    const cost = toDatabaseNumber(amount * BARDEN_PRICE_BR);
    setPendingTrade({
        category: 'bd',
        action: 'buy',
        amount,
        summary: `Buy ${formatNumber(amount)} BD for ${formatMoney(cost)} BR.`,
        confirmText: `Confirm buy ${formatNumber(amount)} BD for ${formatMoney(cost)} BR`
    });
}

async function previewSellBarden() {
    if (!currentUser) return alert('Login first.');
    if (!supportsBardens) return alert('Trading requires the barden_balance column in the profiles table.');

    const amount = Number(getEl('trade-amount-barden')?.value);
    if (!amount || amount <= 0) return alert('Enter a positive BD amount.');

    const proceeds = toDatabaseNumber(amount * BARDEN_PRICE_BR);
    setPendingTrade({
        category: 'bd',
        action: 'sell',
        amount,
        summary: `Sell ${formatNumber(amount)} BD for ${formatMoney(proceeds)} BR.`,
        confirmText: `Confirm sell ${formatNumber(amount)} BD for ${formatMoney(proceeds)} BR`
    });
}

async function confirmBardenTrade() {
    if (!pendingTrade || pendingTrade.category !== 'bd') {
        return alert('Preview a Barden trade before confirming.');
    }

    if (pendingTrade.action === 'buy') {
        await executeBuyBarden(pendingTrade.amount);
    } else {
        await executeSellBarden(pendingTrade.amount);
    }
    clearPendingTrade();
}

function logout() {
    clearSession();
    window.location.href = 'index.html';
}

async function executeBuyBrabills(amount) {
    if (!currentPrice || currentPrice <= 0) return alert('Waiting for live ETH price. Please try again in a moment.');

    const cost = toDatabaseNumber(amount / currentPrice);
    const brokenBalance = Number(currentUser.broken_balance || 0);
    if (cost > brokenBalance) {
        return alert('Not enough BR to buy that amount of BB.');
    }

    const updated = {
        broken_balance: toDatabaseNumber(brokenBalance - cost),
        brabills_balance: toDatabaseNumber(Number(currentUser.brabills_balance || 0) + amount)
    };

    if (!(await saveCurrentUser(updated))) return;

    updatePortfolioDisplay();
    alert(`Bought ${formatNumber(amount)} BB for ${formatMoney(cost)} BR.`);
}

async function executeSellBrabills(amount) {
    const brabillsBalance = Number(currentUser.brabills_balance || 0);
    if (amount > brabillsBalance) {
        return alert('Not enough BB to sell that amount.');
    }

    const proceeds = toDatabaseNumber(amount / currentPrice);
    const updated = {
        brabills_balance: toDatabaseNumber(brabillsBalance - amount),
        broken_balance: toDatabaseNumber(Number(currentUser.broken_balance || 0) + proceeds)
    };

    if (!(await saveCurrentUser(updated))) return;

    updatePortfolioDisplay();
    alert(`Sold ${formatNumber(amount)} BB for ${formatMoney(proceeds)} BR.`);
}

function previewBuyBrabills() {
    if (!currentUser) return alert('Login first.');
    if (!supportsBrabills) return alert('Trading requires the brabills_balance column in the profiles table.');
    if (!currentPrice || currentPrice <= 0) return alert('Waiting for live ETH price. Please try again in a moment.');

    const amount = Number(getEl('trade-amount-bb')?.value);
    if (!amount || amount <= 0) return alert('Enter a positive BB amount.');

    const cost = toDatabaseNumber(amount / currentPrice);
    setPendingTrade({
        category: 'bb',
        action: 'buy',
        amount,
        summary: `Buy ${formatNumber(amount)} BB for ${formatMoney(cost)} BR.`,
        confirmText: `Confirm buy ${formatNumber(amount)} BB for ${formatMoney(cost)} BR`
    });
}

function previewSellBrabills() {
    if (!currentUser) return alert('Login first.');
    if (!supportsBrabills) return alert('Trading requires the brabills_balance column in the profiles table.');
    if (!currentPrice || currentPrice <= 0) return alert('Waiting for live ETH price. Please try again in a moment.');

    const amount = Number(getEl('trade-amount-bb')?.value);
    if (!amount || amount <= 0) return alert('Enter a positive BB amount.');

    const proceeds = toDatabaseNumber(amount / currentPrice);
    setPendingTrade({
        category: 'bb',
        action: 'sell',
        amount,
        summary: `Sell ${formatNumber(amount)} BB for ${formatMoney(proceeds)} BR.`,
        confirmText: `Confirm sell ${formatNumber(amount)} BB for ${formatMoney(proceeds)} BR`
    });
}

async function confirmBrabillsTrade() {
    if (!pendingTrade || pendingTrade.category !== 'bb') {
        return alert('Preview a BB trade before confirming.');
    }

    if (pendingTrade.action === 'buy') {
        await executeBuyBrabills(pendingTrade.amount);
    } else {
        await executeSellBrabills(pendingTrade.amount);
    }
    clearPendingTrade();
}

window.addEventListener('load', async () => {
    if (pageType === 'dashboard') {
        await loadDashboard();
    } else if (pageType === 'login') {
        await detectAssetColumns();
    }
});
