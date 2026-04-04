// Firebase Setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, push, remove, update, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Debug flag
const DEBUG = true;
function log(...args) { if (DEBUG) console.log('[ChatSphere]', ...args); }

/* ──────────────────────────────────────────────
   DOM REFERENCES
   ────────────────────────────────────────────── */
let startButton, stopButton, nextButton, connectButton, reportButton, rateButton;
let localVideo, remoteVideo, videoContainer, loadingSpinner;
let statusEl, chatStatusText, onlineCountEl, waitingUsersEl;
let preChatSection, inChatSection, toolbar;
let reportModal, reportForm, reportSuccess, closeModalBtn, cancelReportBtn, closeSuccessModalBtn;
let ratingModal, ratingForm, ratingSuccess, closeRatingModalBtn, cancelRatingBtn, closeRatingSuccessModalBtn;
let selectedRatingValue;

/* ──────────────────────────────────────────────
   TOAST NOTIFICATION SYSTEM
   ────────────────────────────────────────────── */
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

/* ──────────────────────────────────────────────
   CSRF HELPER
   ────────────────────────────────────────────── */
function getCsrfToken() {
    try {
        const cookieValue = document.cookie
            .split('; ')
            .find(row => row.startsWith('csrftoken='))
            ?.split('=')[1];
        if (!cookieValue) throw new Error('CSRF token not found');
        return cookieValue;
    } catch (error) {
        console.error('Error getting CSRF token:', error);
        throw new Error('Authentication error. Please refresh the page.');
    }
}

/* ──────────────────────────────────────────────
   FIREBASE INIT
   ────────────────────────────────────────────── */
let app, db, auth;
try {
    const firebaseConfig = window.FIREBASE_CONFIG;
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);
    log('Firebase initialized');
} catch (error) {
    console.error('Firebase init failed:', error);
    throw error;
}

/* ──────────────────────────────────────────────
   WEBRTC CONFIG
   ────────────────────────────────────────────── */
async function checkMediaPermissions() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(track => track.stop());
        updateStatus('Camera and microphone access granted');
        return true;
    } catch (error) {
        console.error('Media permission error:', error);
        updateStatus('Error: ' + error.message);
        return false;
    }
}

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    ],
    iceCandidatePoolSize: 10,
};
let pc = new RTCPeerConnection(servers);

/* ──────────────────────────────────────────────
   APP STATE
   ────────────────────────────────────────────── */
let localStream = null;
let remoteStream = null;
let currentRoomId = null;
let userId = null;
let djangoUserId = window.DJANGO_USER_ID || "";
let peerDjangoUserId = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let roomListener = null;
let isReconnecting = false;

log('Django User ID:', djangoUserId);

/* ──────────────────────────────────────────────
   TOOLBAR AUTO-HIDE
   ────────────────────────────────────────────── */
let hideTimer = null;
const HIDE_DELAY = 3000;

function showToolbar() {
    if (!toolbar) return;
    toolbar.classList.remove('auto-hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        toolbar.classList.add('auto-hidden');
    }, HIDE_DELAY);
}

function setupToolbarAutoHide() {
    if (!inChatSection) return;

    inChatSection.addEventListener('mousemove', showToolbar);
    inChatSection.addEventListener('touchstart', showToolbar, { passive: true });

    // Keep toolbar visible when hovering over it
    if (toolbar) {
        toolbar.addEventListener('mouseenter', () => {
            clearTimeout(hideTimer);
            toolbar.classList.remove('auto-hidden');
        });
        toolbar.addEventListener('mouseleave', () => {
            hideTimer = setTimeout(() => {
                toolbar.classList.add('auto-hidden');
            }, HIDE_DELAY);
        });
    }

    // Initial show then auto-hide
    showToolbar();
}

/* ──────────────────────────────────────────────
   STATUS UPDATE
   ────────────────────────────────────────────── */
function updateStatus(message, isError = false) {
    log(message);
    // Update pre-chat status
    if (statusEl) statusEl.textContent = message;
    // Update in-chat status
    if (chatStatusText) chatStatusText.textContent = message;
}

/* ──────────────────────────────────────────────
   UI STATE TRANSITIONS
   ────────────────────────────────────────────── */
function showInChat() {
    if (preChatSection) preChatSection.classList.add('hidden');
    if (inChatSection) inChatSection.classList.remove('hidden');
    setupToolbarAutoHide();
}

function showPreChat() {
    if (inChatSection) inChatSection.classList.add('hidden');
    if (preChatSection) preChatSection.classList.remove('hidden');
    clearTimeout(hideTimer);
}

/* ──────────────────────────────────────────────
   START CHAT
   ────────────────────────────────────────────── */
async function startChat() {
    log('Start button clicked');
    try {
        if (!userId) throw new Error('Not authenticated. Please refresh.');
        startButton.disabled = true;
        updateStatus('Starting video chat…');
        await setupStreams();
        await findOrCreateRoom();
    } catch (error) {
        console.error('Error starting chat:', error);
        startButton.disabled = false;
        showPreChat();
        updateStatus('Failed to start: ' + error.message, true);
    }
}

/* ──────────────────────────────────────────────
   CONNECTION STATE LISTENERS
   ────────────────────────────────────────────── */
pc.onconnectionstatechange = () => {
    log("Connection state:", pc.connectionState);
    updateStatus("Connection: " + pc.connectionState);
};

pc.oniceconnectionstatechange = () => {
    log("ICE state:", pc.iceConnectionState);
};

pc.onsignalingstatechange = () => {
    log("Signaling state:", pc.signalingState);
};

/* ──────────────────────────────────────────────
   PRESENCE SYSTEM
   ────────────────────────────────────────────── */
async function setupPresence() {
    if (!userId) return;
    try {
        const presenceRef = ref(db, `presence/${userId}`);

        async function updatePresence() {
            await set(presenceRef, { online: true, lastSeen: Date.now() });
        }

        await updatePresence();
        window.presenceInterval = setInterval(updatePresence, 30000);
        onDisconnect(presenceRef).remove();

        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) {
                await update(presenceRef, { online: false, lastSeen: Date.now() });
            } else {
                await updatePresence();
            }
        });

        window.addEventListener('beforeunload', () => {
            navigator.sendBeacon && set(presenceRef, { online: false, lastSeen: Date.now() });
        });

        log('Presence tracking setup');
    } catch (error) {
        console.error('Presence error:', error);
    }
}

function trackOnlineUsers() {
    const roomsRef = ref(db, 'rooms');
    const waitingRoomsRef = ref(db, 'waiting_rooms');

    async function updateOnlineCount() {
        try {
            const [roomsSnapshot, waitingSnapshot] = await Promise.all([get(roomsRef), get(waitingRoomsRef)]);
            const uniqueUsers = new Set();

            const rooms = roomsSnapshot.val();
            if (rooms) {
                Object.values(rooms).forEach(room => {
                    if (room.creatorId) uniqueUsers.add(room.creatorId);
                    if (room.joinerId) uniqueUsers.add(room.joinerId);
                });
            }

            const waitingRooms = waitingSnapshot.val();
            if (waitingRooms) {
                Object.values(waitingRooms).forEach(room => {
                    if (room.creatorId) uniqueUsers.add(room.creatorId);
                });
            }

            if (onlineCountEl) onlineCountEl.textContent = uniqueUsers.size;
        } catch (error) {
            console.error('Error updating online count:', error);
            if (onlineCountEl) onlineCountEl.textContent = '0';
        }
    }

    onValue(roomsRef, () => updateOnlineCount(), err => console.error(err));
    onValue(waitingRoomsRef, () => updateOnlineCount(), err => console.error(err));
    updateOnlineCount();
}

function trackWaitingUsers() {
    onValue(ref(db, 'waiting_rooms'), (snapshot) => {
        const rooms = snapshot.val();
        const count = rooms ? Object.keys(rooms).length : 0;
        if (waitingUsersEl) {
            waitingUsersEl.textContent = count > 0
                ? `${count} ${count === 1 ? 'person' : 'people'} waiting to chat`
                : '';
        }
    });
}

async function removePresence() {
    if (!userId) return;
    try { await remove(ref(db, `presence/${userId}`)); } catch (e) { /* ignore */ }
}

/* ──────────────────────────────────────────────
   ROOM MONITORING
   ────────────────────────────────────────────── */
function monitorRoomStatus() {
    if (!currentRoomId) return;

    if (roomListener) roomListener();

    roomListener = onValue(ref(db, `rooms/${currentRoomId}`), async (snapshot) => {
        const roomData = snapshot.val();

        if (!roomData && !isReconnecting) {
            log('Room deleted — peer left');
            isReconnecting = true;
            updateStatus('Stranger left. Finding new partner…');

            if (roomListener) { roomListener(); roomListener = null; }

            currentRoomId = null;

            // Keep local camera alive, only stop remote
            if (remoteStream) remoteStream.getTracks().forEach(t => t.stop());
            if (pc) { pc.close(); pc = new RTCPeerConnection(servers); }

            try {
                await setupStreams();
                await findOrCreateRoom();
            } catch (err) {
                console.error('Reconnect error:', err);
                updateStatus('Error finding new chat.');
            } finally {
                isReconnecting = false;
            }
        }
    });
}

/* ──────────────────────────────────────────────
   STALE ROOM CLEANUP
   ────────────────────────────────────────────── */
async function cleanupAllStaleRooms() {
    try {
        const STALE_TIMEOUT = 120000;
        const now = Date.now();

        for (const path of ['rooms', 'waiting_rooms']) {
            const snapshot = await get(ref(db, path));
            if (!snapshot.exists()) continue;
            for (const [id, room] of Object.entries(snapshot.val())) {
                if ((room.createdAt && now - room.createdAt > STALE_TIMEOUT) || !room.createdAt) {
                    await remove(ref(db, `${path}/${id}`));
                }
            }
        }
    } catch (err) {
        console.error('Stale cleanup error:', err);
    }
}

/* ──────────────────────────────────────────────
   INITIALIZE
   ────────────────────────────────────────────── */
async function initialize() {
    log('Initializing');
    try {
        if (!window.FIREBASE_CONFIG) throw new Error('Firebase config not found');

        updateStatus('Connecting…');
        await signInAnonymously(auth);
    } catch (error) {
        console.error('Auth failed:', error);
        updateStatus('Authentication error: ' + error.message, true);
        return;
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            log('Authenticated. UID:', user.uid);
            userId = user.uid;

            await cleanupAllStaleRooms();
            trackOnlineUsers();
            trackWaitingUsers();

            startButton.disabled = false;
            updateStatus('Ready — click Start Chat to begin!');

            try { await setupPresence(); } catch (e) { /* non-fatal */ }
        } else {
            userId = null;
            startButton.disabled = true;
            updateStatus('Authentication required.', true);
        }
    });
}

/* ──────────────────────────────────────────────
   SETUP STREAMS
   ────────────────────────────────────────────── */
const setupStreams = async () => {
    try {
        // Reuse existing local stream if still active (avoids re-prompting camera)
        if (!localStream || localStream.getTracks().every(t => t.readyState === 'ended')) {
            updateStatus('Requesting camera & mic…');
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }

        remoteStream = new MediaStream();

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        };

        localVideo.srcObject = localStream;
        remoteVideo.srcObject = remoteStream;

        // Switch to in-chat view
        showInChat();
    } catch (error) {
        console.error("Media Error:", error);
        const msgs = {
            NotAllowedError: "Camera/Mic access denied. Check permissions.",
            NotFoundError: "No camera or microphone found.",
            NotReadableError: "Camera/Mic in use by another app."
        };
        updateStatus(msgs[error.name] || "Could not access camera/microphone.", true);
        throw error;
    }
};

/* ──────────────────────────────────────────────
   CLEANUP ROOMS FOR USER
   ────────────────────────────────────────────── */
async function cleanupRooms() {
    for (const path of ['rooms', 'waiting_rooms']) {
        const snapshot = await get(ref(db, path));
        if (!snapshot.exists()) continue;
        for (const [key, room] of Object.entries(snapshot.val())) {
            if (room.creatorId === userId || room.joinerId === userId) {
                await remove(ref(db, `${path}/${key}`));
            }
        }
    }
}

/* ──────────────────────────────────────────────
   FIND OR CREATE ROOM
   ────────────────────────────────────────────── */
async function findOrCreateRoom() {
    try {
        updateStatus('Looking for a stranger…');
        loadingSpinner.classList.remove('hidden');
        nextButton.disabled = true;

        if (!djangoUserId || djangoUserId === 'None' || djangoUserId === '') {
            throw new Error('User ID not set. Please refresh.');
        }

        const waitingRooms = await get(ref(db, 'waiting_rooms'));

        if (waitingRooms.exists()) {
            const rooms = waitingRooms.val();
            const availableRoom = Object.entries(rooms).find(([_, room]) => room.creatorId !== userId);

            if (availableRoom) {
                const [roomId, roomData] = availableRoom;
                updateStatus('Found a stranger! Connecting…');
                currentRoomId = roomId;

                const existingRoomSnapshot = await get(ref(db, `rooms/${roomId}`));
                const existingRoomData = existingRoomSnapshot.val();

                if (!existingRoomData) throw new Error('Room data not found.');
                if (!existingRoomData.offer) throw new Error('No offer found in room.');

                peerDjangoUserId = existingRoomData.creatorDjangoId;
                if (peerDjangoUserId) loadPeerStats(peerDjangoUserId);

                await remove(ref(db, `waiting_rooms/${roomId}`));
                await update(ref(db, `rooms/${roomId}`), {
                    status: 'full',
                    joinerId: userId,
                    joinerDjangoId: djangoUserId
                });

                updateStatus('Connecting to stranger…');
                await startCallAsCallee();
                return;
            }
        }

        // No available rooms — create one
        await cleanupRooms();

        const newRoomRef = push(ref(db, 'rooms'));
        currentRoomId = newRoomRef.key;
        const timestamp = Date.now();

        const offerDescription = await pc.createOffer();
        await pc.setLocalDescription(offerDescription);

        await set(newRoomRef, {
            creatorId: userId,
            creatorDjangoId: djangoUserId,
            status: 'waiting',
            createdAt: timestamp,
            offer: { sdp: offerDescription.sdp, type: offerDescription.type }
        });

        await set(ref(db, `waiting_rooms/${currentRoomId}`), {
            creatorId: userId,
            creatorDjangoId: djangoUserId,
            status: 'waiting',
            createdAt: timestamp
        });

        await startCallAsCaller();
    } catch (error) {
        console.error("findOrCreateRoom error:", error);
        updateStatus(`Error: ${error.message}`);
        loadingSpinner.classList.add('hidden');
        nextButton.disabled = false;
        if (currentRoomId) await cleanup();
        throw error;
    }
}

/* ──────────────────────────────────────────────
   CALLER / CALLEE
   ────────────────────────────────────────────── */
const startCallAsCaller = async () => {
    const roomRef = ref(db, `rooms/${currentRoomId}`);

    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            await push(ref(db, `rooms/${currentRoomId}/callerCandidates`), event.candidate.toJSON());
        }
    };

    onValue(roomRef, async (snapshot) => {
        const data = snapshot.val();
        if (!pc.currentRemoteDescription && data?.answer) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

            peerDjangoUserId = data.joinerDjangoId;
            if (peerDjangoUserId) loadPeerStats(peerDjangoUserId);

            updateStatus('Stranger connected!');
            loadingSpinner.classList.add('hidden');
            nextButton.disabled = false;
            monitorRoomStatus();
        }
    });

    onValue(ref(db, `rooms/${currentRoomId}/calleeCandidates`), (snapshot) => {
        snapshot.forEach(child => pc.addIceCandidate(new RTCIceCandidate(child.val())));
    });
};

const startCallAsCallee = async () => {
    const roomRef = ref(db, `rooms/${currentRoomId}`);

    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            await push(ref(db, `rooms/${currentRoomId}/calleeCandidates`), event.candidate.toJSON());
        }
    };

    try {
        const roomSnapshot = await get(roomRef);
        const roomData = roomSnapshot.val();

        if (!roomData || !roomData.offer?.type || !roomData.offer?.sdp) {
            throw new Error('No valid offer in room');
        }

        await pc.setRemoteDescription(new RTCSessionDescription(roomData.offer));
        const answerDescription = await pc.createAnswer();
        await pc.setLocalDescription(answerDescription);

        await update(roomRef, {
            answer: { type: answerDescription.type, sdp: answerDescription.sdp }
        });

        onValue(ref(db, `rooms/${currentRoomId}/callerCandidates`), (snapshot) => {
            snapshot.forEach(child => {
                pc.addIceCandidate(new RTCIceCandidate(child.val())).catch(e => log('ICE error:', e));
            });
        });

        updateStatus('Connected to stranger!');
        loadingSpinner.classList.add('hidden');
        nextButton.disabled = false;
        monitorRoomStatus();
    } catch (error) {
        console.error('Callee error:', error);
        updateStatus(`Connection failed: ${error.message}`);
        throw error;
    }
};

/* ──────────────────────────────────────────────
   CLEANUP
   ────────────────────────────────────────────── */
const cleanup = async (keepLocalStream = false) => {
    if (roomListener) { roomListener(); roomListener = null; }

    if (currentRoomId) {
        try {
            await remove(ref(db, `rooms/${currentRoomId}`));
            await remove(ref(db, `waiting_rooms/${currentRoomId}`));
        } catch (e) { /* ignore */ }
    }

    // Only stop local camera when fully ending the chat
    if (!keepLocalStream) {
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        if (localVideo?.srcObject) localVideo.srcObject = null;
    }

    if (remoteStream) { remoteStream.getTracks().forEach(t => t.stop()); remoteStream = null; }

    if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.close();
        pc = new RTCPeerConnection(servers);
    }

    if (remoteVideo?.srcObject) remoteVideo.srcObject = null;

    currentRoomId = null;
    peerDjangoUserId = null;
    clearPeerStats();
    resetMediaButtons();
    isAudioEnabled = true;
    isVideoEnabled = true;
};

/* ──────────────────────────────────────────────
   STOP / NEXT
   ────────────────────────────────────────────── */
const stopChat = async () => {
    stopButton.disabled = true;
    updateStatus('Ending chat…');
    await cleanup();
    showPreChat();
    startButton.disabled = false;
    stopButton.disabled = false;
    updateStatus('Chat ended — click Start Chat to begin again.');
};

const findNewChat = async () => {
    nextButton.disabled = true;
    updateStatus('Finding new stranger…');
    await cleanup(true); // keep local camera alive
    try {
        await setupStreams();
        await findOrCreateRoom();
    } catch (error) {
        console.error('Next chat error:', error);
        nextButton.disabled = false;
        updateStatus(`Error: ${error.message}`);
    }
};

/* ──────────────────────────────────────────────
   1-CLICK CONNECT
   ────────────────────────────────────────────── */
async function connectWithStranger() {
    if (!peerDjangoUserId) {
        showToast('Cannot identify stranger. Try again.', 'error');
        return;
    }

    connectButton.disabled = true;

    try {
        const response = await fetch('/submit-connection/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ connection_user_id: peerDjangoUserId })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Connected! You can message them later.', 'success');
            connectButton.classList.add('connect-success');
            setTimeout(() => connectButton.classList.remove('connect-success'), 2000);
        } else {
            showToast(data.error || 'Connection failed.', 'error');
        }
    } catch (error) {
        console.error('Connect error:', error);
        showToast('Connection failed. Try again.', 'error');
    } finally {
        connectButton.disabled = false;
    }
}

/* ──────────────────────────────────────────────
   PEER STATS
   ────────────────────────────────────────────── */
async function loadPeerStats(peerId) {
    if (!peerId) return;
    clearPeerStats();

    try {
        const response = await fetch(`/get-peer-stats/${peerId}/`);
        if (!response.ok) return;

        const data = await response.json();
        if (data.success) displayPeerStats(data);
    } catch (error) {
        log('Peer stats error:', error);
    }
}

function displayPeerStats(stats) {
    const badge = document.getElementById('peerStatsBadge');
    const content = document.getElementById('badgeContent');
    if (!badge || !content) return;

    if (stats.is_new_user) {
        content.innerHTML = '<span class="badge-new">🆕 NEW USER</span>';
    } else {
        content.innerHTML = `
            <span class="badge-stat">✨ ${stats.aura_points}</span>
            <span class="badge-stat">⭐ ${stats.avg_rating}</span>
            <span class="badge-stat">${stats.total_ratings} ratings</span>
        `;
    }

    badge.classList.remove('hidden');
}

function clearPeerStats() {
    const badge = document.getElementById('peerStatsBadge');
    const content = document.getElementById('badgeContent');
    if (badge) badge.classList.add('hidden');
    if (content) content.innerHTML = '<span class="badge-loading">Loading…</span>';
}

function resetMediaButtons() {
    const toggleAudio = document.getElementById('toggleAudio');
    const toggleVideo = document.getElementById('toggleVideo');
    const micOn = document.getElementById('micOnIcon');
    const micOff = document.getElementById('micOffIcon');
    const camOn = document.getElementById('camOnIcon');
    const camOff = document.getElementById('camOffIcon');

    isAudioEnabled = true;
    isVideoEnabled = true;

    if (toggleAudio) toggleAudio.classList.remove('is-off');
    if (toggleVideo) toggleVideo.classList.remove('is-off');
    if (micOn) micOn.classList.remove('hidden');
    if (micOff) micOff.classList.add('hidden');
    if (camOn) camOn.classList.remove('hidden');
    if (camOff) camOff.classList.add('hidden');
}

/* ──────────────────────────────────────────────
   PAGE LOAD — WIRE EVERYTHING UP
   ────────────────────────────────────────────── */
window.addEventListener('load', async () => {
    try {
        log('Page loaded');

        // Sections
        preChatSection = document.getElementById('pre-chat');
        inChatSection = document.getElementById('in-chat');
        toolbar = document.getElementById('toolbar');

        // Pre-chat
        startButton = document.getElementById('startButton');
        statusEl = document.getElementById('status');
        onlineCountEl = document.getElementById('online-count');
        waitingUsersEl = document.getElementById('waiting-users');

        // Video
        localVideo = document.getElementById('localVideo');
        remoteVideo = document.getElementById('remoteVideo');
        videoContainer = document.getElementById('remoteVideoContainer');
        loadingSpinner = document.getElementById('loading-spinner');
        chatStatusText = document.getElementById('chat-status-text');

        // Toolbar buttons
        stopButton = document.getElementById('stopButton');
        nextButton = document.getElementById('nextButton');
        connectButton = document.getElementById('connectButton');
        reportButton = document.getElementById('reportButton');
        rateButton = document.getElementById('rateButton');

        // Report modal
        reportModal = document.getElementById('reportModal');
        reportForm = document.getElementById('reportForm');
        reportSuccess = document.getElementById('reportSuccess');
        closeModalBtn = document.getElementById('closeModal');
        cancelReportBtn = document.getElementById('cancelReport');
        closeSuccessModalBtn = document.getElementById('closeSuccessModal');

        // Rating modal
        ratingModal = document.getElementById('ratingModal');
        ratingForm = document.getElementById('ratingForm');
        ratingSuccess = document.getElementById('ratingSuccess');
        closeRatingModalBtn = document.getElementById('closeRatingModal');
        cancelRatingBtn = document.getElementById('cancelRating');
        closeRatingSuccessModalBtn = document.getElementById('closeRatingSuccessModal');

        log('DOM elements initialized');

        /* ── Button handlers ── */
        startButton.addEventListener('click', startChat);
        stopButton.addEventListener('click', stopChat);
        nextButton.addEventListener('click', findNewChat);

        // 1-click connect
        if (connectButton) {
            connectButton.addEventListener('click', connectWithStranger);
        }

        // Mic toggle
        document.getElementById('toggleAudio').onclick = () => {
            if (!localStream) return;
            const track = localStream.getAudioTracks()[0];
            if (!track) return;

            isAudioEnabled = !isAudioEnabled;
            track.enabled = isAudioEnabled;

            const btn = document.getElementById('toggleAudio');
            const micOn = document.getElementById('micOnIcon');
            const micOff = document.getElementById('micOffIcon');

            btn.classList.toggle('is-off', !isAudioEnabled);
            micOn.classList.toggle('hidden', !isAudioEnabled);
            micOff.classList.toggle('hidden', isAudioEnabled);
        };

        // Camera toggle
        document.getElementById('toggleVideo').onclick = () => {
            if (!localStream) return;
            const track = localStream.getVideoTracks()[0];
            if (!track) return;

            isVideoEnabled = !isVideoEnabled;
            track.enabled = isVideoEnabled;

            const btn = document.getElementById('toggleVideo');
            const camOn = document.getElementById('camOnIcon');
            const camOff = document.getElementById('camOffIcon');

            btn.classList.toggle('is-off', !isVideoEnabled);
            camOn.classList.toggle('hidden', !isVideoEnabled);
            camOff.classList.toggle('hidden', isVideoEnabled);
        };

        /* ── Report modal ── */
        reportButton.onclick = () => {
            reportModal.classList.remove('hidden');
        };

        closeModalBtn.onclick = () => {
            reportModal.classList.add('hidden');
            reportForm.reset();
        };

        cancelReportBtn.onclick = () => {
            reportModal.classList.add('hidden');
            reportForm.reset();
        };

        closeSuccessModalBtn.onclick = () => {
            reportModal.classList.add('hidden');
            reportForm.classList.remove('hidden');
            reportSuccess.classList.add('hidden');
            reportForm.reset();
        };

        reportForm.onsubmit = async (e) => {
            e.preventDefault();
            const reason = document.getElementById('reportReason').value;
            const description = document.getElementById('reportDescription').value;

            if (!reason || !description.trim()) {
                showToast('Please fill in all fields.', 'warning');
                return;
            }

            if (!peerDjangoUserId) {
                showToast('Unable to identify user to report.', 'error');
                return;
            }

            try {
                const response = await fetch('/report-user/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                    body: JSON.stringify({
                        room_id: currentRoomId,
                        reported_user_id: peerDjangoUserId,
                        reason, description
                    })
                });
                const data = await response.json();
                if (response.ok && data.success) {
                    reportForm.classList.add('hidden');
                    reportSuccess.classList.remove('hidden');
                } else {
                    showToast(data.error || 'Failed to submit report.', 'error');
                }
            } catch (error) {
                console.error('Report error:', error);
                showToast('Failed to submit report.', 'error');
            }
        };

        /* ── Inline star-rating popover ── */
        const popStars = document.querySelectorAll('.pop-star');

        // Hover: highlight all stars up to the hovered one
        popStars.forEach((star, idx) => {
            star.addEventListener('mouseenter', () => {
                popStars.forEach((s, i) => {
                    s.classList.toggle('star-hover', i <= idx);
                });
            });

            star.addEventListener('mouseleave', () => {
                popStars.forEach(s => s.classList.remove('star-hover'));
            });

            // Click: submit immediately
            star.addEventListener('click', async () => {
                const rating = parseInt(star.getAttribute('data-rating'));

                if (!peerDjangoUserId) {
                    showToast('Cannot identify stranger.', 'error');
                    return;
                }

                // Flash all stars gold briefly
                popStars.forEach((s, i) => {
                    s.classList.toggle('star-hover', i < rating);
                });

                try {
                    const response = await fetch('/submit-rating/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                        body: JSON.stringify({ rated_user_id: peerDjangoUserId, rate_points: rating })
                    });
                    const data = await response.json();
                    if (response.ok && data.success) {
                        showToast(`Rated ${rating} star${rating > 1 ? 's' : ''} ⭐`, 'success');
                    } else {
                        showToast(data.error || 'Failed to submit rating.', 'error');
                    }
                } catch (error) {
                    console.error('Rating error:', error);
                    showToast('Failed to submit rating.', 'error');
                }

                // Reset star highlights after a moment
                setTimeout(() => {
                    popStars.forEach(s => s.classList.remove('star-hover'));
                }, 600);
            });
        });

        log('All handlers attached');

        await checkMediaPermissions();
        await initialize();
        log('Initialization complete');
    } catch (error) {
        console.error('Init error:', error);
        if (statusEl) statusEl.textContent = 'Failed to initialize. Please refresh.';
    }
});

window.addEventListener('beforeunload', async () => { await removePresence(); });
