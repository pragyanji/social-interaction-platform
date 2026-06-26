// Firebase Setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, push, remove, update, serverTimestamp, onDisconnect, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Debug flag
// const DEBUG = true;
const DEBUG = false;

function log(...args) { if (DEBUG) console.log('[ChatSphere]', ...args); }

/* ──────────────────────────────────────────────
   DOM REFERENCES
   ────────────────────────────────────────────── */
let startButton, stopButton, nextButton, connectButton, reportButton;
let localVideo, remoteVideo, videoContainer, loadingSpinner;
let statusEl, chatStatusText, onlineCountEl, waitingUsersEl;
let preChatSection, inChatSection, toolbar;
let reportModal, reportForm, reportSuccess, closeModalBtn, cancelReportBtn, closeSuccessModalBtn;
let ratingModal, ratingForm, ratingSuccess, closeRatingModalBtn, cancelRatingBtn, closeRatingSuccessModalBtn;
let selectedRatingValue;
let localPanel, remotePanel;

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
        // NOTE: For video/audio to work across different networks (e.g. Wi-Fi to Cellular),
        // you MUST configure a TURN server below. STUN is not sufficient for symmetric NATs.
        // You can register for free TURN credentials from Metered.ca, Twilio, or Xirsys.
        /*
        {
            urls: ['turn:your-turn-server.com:3478'],
            username: 'your-username',
            credential: 'your-password'
        }
        */
    ],
    iceCandidatePoolSize: 10,
};

function createPeerConnection() {
    const peerConnection = new RTCPeerConnection(servers);

    peerConnection.onconnectionstatechange = () => {
        log("Connection state:", peerConnection.connectionState);
        updateStatus("Connection: " + peerConnection.connectionState);
    };

    peerConnection.oniceconnectionstatechange = () => {
        log("ICE state:", peerConnection.iceConnectionState);
    };

    peerConnection.onsignalingstatechange = () => {
        log("Signaling state:", peerConnection.signalingState);
    };

    return peerConnection;
}

let pc = createPeerConnection();

/* ──────────────────────────────────────────────
   APP STATE
   ────────────────────────────────────────────── */
let localStream = null;
let remoteStream = null;
let currentRoomId = null;
let userId = null;
const sessionId = 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
let djangoUserId = window.DJANGO_USER_ID || "";
let peerDjangoUserId = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let roomListener = null;
let isReconnecting = false;
let reportedPeersToday = new Set();
let ratedPeersToday = new Set();
let isMatching = false;
let lastPeerDjangoId = null;
let lastPeerSessionId = null;

log('Django User ID:', djangoUserId);

/* ──────────────────────────────────────────────
   CONTENT MODERATION STATE & HELPERS
   ────────────────────────────────────────────── */
let nsfwModel = null;
let moderationInterval = null;
const SCAN_INTERVAL = 3000; // 3 seconds

async function loadNSFWModel() {
    try {
        // Wait for TF.js and NSFWJS CDN scripts to fully load
        log('Waiting for TF.js + NSFWJS CDN scripts...');
        if (window.__nsfwReady) {
            await window.__nsfwReady;
        }
        
        if (typeof tf === 'undefined') {
            console.error('TensorFlow.js is not available on the page. Model loading aborted.');
            return;
        }
        if (typeof nsfwjs === 'undefined') {
            console.error('NSFWJS library is not available on the page. Model loading aborted.');
            return;
        }
        
        log('TF.js version:', tf.version ? tf.version.tfjs : (tf.version_core || 'unknown'));
        log('Forcing CPU backend for precision consistency (safeguard against WebGL Apple Silicon bugs)...');
        await tf.setBackend('cpu');
        await tf.ready();
        log('TF.js backend ready:', tf.getBackend());
        
        log('Loading NSFWJS model (MobileNetV2 from CDN)...');
        nsfwModel = await nsfwjs.load('https://cdn.jsdelivr.net/gh/infinitered/nsfwjs@v2.4.1/example/nsfw_demo/public/quant_nsfw_mobilenet/');
        log('✅ NSFW model loaded successfully. Model object:', nsfwModel);
    } catch (e) {
        console.error('NSFWJS Model load failed:', e);
        console.error('Stack trace:', e.stack);
    }
}

function startModeration() {
    if (moderationInterval) return;
    let lastFrameHash = null;
    
    // Add debug visualizer if DEBUG is active
    let debugCanvas = document.getElementById('nsfwDebugCanvas');
    if (!debugCanvas && DEBUG) {
        debugCanvas = document.createElement('canvas');
        debugCanvas.id = 'nsfwDebugCanvas';
        debugCanvas.style.position = 'fixed';
        debugCanvas.style.bottom = '10px';
        debugCanvas.style.left = '10px';
        debugCanvas.style.width = '112px';
        debugCanvas.style.height = '112px';
        debugCanvas.style.zIndex = '9999';
        debugCanvas.style.border = '2px solid var(--danger, #ef4444)';
        debugCanvas.style.borderRadius = '6px';
        debugCanvas.style.backgroundColor = 'black';
        document.body.appendChild(debugCanvas);
        
        // Add a small label
        const debugLabel = document.createElement('div');
        debugLabel.id = 'nsfwDebugLabel';
        debugLabel.innerText = 'NSFW Scan Frame';
        debugLabel.style.position = 'fixed';
        debugLabel.style.bottom = '125px';
        debugLabel.style.left = '10px';
        debugLabel.style.zIndex = '9999';
        debugLabel.style.background = 'rgba(0,0,0,0.8)';
        debugLabel.style.color = 'white';
        debugLabel.style.fontSize = '10px';
        debugLabel.style.padding = '2px 6px';
        debugLabel.style.borderRadius = '4px';
        document.body.appendChild(debugLabel);
    }
    
    log('🔍 Starting moderation loop. Current state:');
    log('  - nsfwModel:', nsfwModel ? 'LOADED' : 'NOT LOADED');
    log('  - remoteVideo element:', remoteVideo ? 'FOUND' : 'MISSING');
    log('  - peerDjangoUserId:', peerDjangoUserId || 'NOT SET');
    
    moderationInterval = setInterval(async () => {
        if (!remoteVideo) {
            log('⏭️ Moderation skip: remoteVideo element not found.');
            return;
        }
        
        const vw = remoteVideo.videoWidth;
        const vh = remoteVideo.videoHeight;
        const rs = remoteVideo.readyState;
        
        // readyState >= 1 (HAVE_METADATA) is enough, but also check that video dimensions are valid
        if (rs < 1 || vw === 0 || vh === 0) {
            log(`⏭️ Moderation skip: video not rendering yet (readyState=${rs}, ${vw}x${vh}).`);
            return;
        }
        if (!nsfwModel) {
            log('⏭️ Moderation skip: NSFWJS model not loaded yet.');
            return;
        }
        if (!peerDjangoUserId) {
            log('⏭️ Moderation skip: peerDjangoUserId not resolved.');
            return;
        }
        
        // Capture the remote video frame at 224x224 (NSFWJS expected input size)
        log('📸 Attempting to capture remote video frame...');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 224;
        canvas.height = 224;
        ctx.drawImage(remoteVideo, 0, 0, 224, 224);
        log(`📸 Captured 224x224 frame from remoteVideo (src dimensions: ${vw}x${vh}, readyState: ${rs})`);
        
        // Update debug visualizer
        if (debugCanvas) {
            debugCanvas.width = 224;
            debugCanvas.height = 224;
            const debugCtx = debugCanvas.getContext('2d');
            debugCtx.drawImage(canvas, 0, 0);
        }
        
        // Quick sanity check: is the canvas actually drawing anything?
        const pixelCheck = ctx.getImageData(112, 112, 1, 1).data;
        const isBlank = pixelCheck[0] === 0 && pixelCheck[1] === 0 && pixelCheck[2] === 0 && pixelCheck[3] === 0;
        if (isBlank) {
            log('⏭️ Moderation skip: captured frame is blank (all black). Remote stream may not have video data.');
            return;
        }

        // Dynamic freeze check: has the frame content changed?
        // Sample pixels across a 3x3 grid to detect changes
        let currentFrameHash = 0;
        const sampleCoords = [56, 112, 168];
        for (const x of sampleCoords) {
            for (const y of sampleCoords) {
                const pixel = ctx.getImageData(x, y, 1, 1).data;
                currentFrameHash += pixel[0] + pixel[1] + pixel[2] + pixel[3];
            }
        }
        
        if (lastFrameHash !== null && currentFrameHash === lastFrameHash) {
            log('⏭️ Moderation skip: frame is 100% identical to the previous one (frozen/static stream).');
            return;
        }
        lastFrameHash = currentFrameHash;
        
        try {
            log('🔬 Classifying remote video frame...');
            const predictions = await nsfwModel.classify(canvas);
            log('📊 Classification results:', JSON.stringify(predictions));
            
            const porn = predictions.find(p => p.className === 'Porn')?.probability || 0;
            const hentai = predictions.find(p => p.className === 'Hentai')?.probability || 0;
            const combinedScore = Math.max(porn, hentai);
            
            log(`   Porn: ${(porn * 100).toFixed(1)}%, Hentai: ${(hentai * 100).toFixed(1)}%, Max: ${(combinedScore * 100).toFixed(1)}%`);
            
            if (combinedScore > 0.70) {
                log('🚨 Inappropriate content detected client-side! Score:', combinedScore);
                await handleNSFWViolation(combinedScore, canvas);
            }
        } catch (e) {
            console.error('Classification error:', e);
        }
    }, SCAN_INTERVAL);
    log('✅ Automated moderation scanning started (interval: ' + SCAN_INTERVAL + 'ms)');
}

function stopModeration() {
    if (moderationInterval) {
        clearInterval(moderationInterval);
        moderationInterval = null;
        log('Automated moderation scanning stopped');
    }
    const overlay = document.getElementById('nsfwBlurOverlay');
    if (overlay) overlay.classList.add('hidden');
    
    // Clean up debug visualizer
    const debugCanvas = document.getElementById('nsfwDebugCanvas');
    const debugLabel = document.getElementById('nsfwDebugLabel');
    if (debugCanvas) debugCanvas.remove();
    if (debugLabel) debugLabel.remove();
}

async function handleNSFWViolation(confidence, canvas) {
    // 1. Blur the video instantly client-side
    const overlay = document.getElementById('nsfwBlurOverlay');
    if (overlay) overlay.classList.remove('hidden');
    
    showToast('⚠️ Inappropriate content detected. Verifying...', 'warning', 4000);
    
    // 2. Extract base64 image data (low-quality JPEG to minimize payload size)
    const frameData = canvas.toDataURL('image/jpeg', 0.6);
    
    // 3. Post to the frame moderation endpoint for server-side verification
    try {
        const response = await fetch('/api/moderate-frame/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({
                frame: frameData,
                user_id: peerDjangoUserId,
                confidence: confidence
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            if (result.status === 'nsfw') {
                if (result.action === 'ban') {
                    showToast('🔴 Stranger has been permanently banned for terms violation.', 'error', 5000);
                    await cleanup();
                    showPreChat();
                } else {
                    showToast('⚠️ Stranger flagged for NSFW video violation. Warning issued.', 'warning', 5000);
                    // Skip stranger automatically
                    setTimeout(async () => {
                        updateStatus('Skipping violator...');
                        await findNewChat();
                    }, 2000);
                }
            } else {
                log('Server verified frame as safe. Unblurring remote video.');
                if (overlay) overlay.classList.add('hidden');
            }
        } else {
            console.error('Server moderation validation failed');
        }
    } catch (err) {
        console.error('Moderation request failed:', err);
    }
}


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

            await cleanup(true); // keep local camera alive and clean up all signaling/UI state

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
        const MAX_CALL_DURATION = 1800000; // 30 minutes
        const now = Date.now();

        for (const path of ['rooms', 'waiting_rooms']) {
            const snapshot = await get(ref(db, path));
            if (!snapshot.exists()) continue;
            for (const [id, room] of Object.entries(snapshot.val())) {
                const isWaitingRoom = room.status === 'waiting' || path === 'waiting_rooms';
                const isStaleWaiting = isWaitingRoom && room.createdAt && (now - room.createdAt > STALE_TIMEOUT);
                const isStaleFull = room.status === 'full' && room.createdAt && (now - room.createdAt > MAX_CALL_DURATION);
                const isCorrupt = !room.createdAt;

                if (isStaleWaiting || isStaleFull || isCorrupt) {
                    await remove(ref(db, `${path}/${id}`));
                }
            }
        }
    } catch (err) {
        console.error('Stale cleanup error:', err);
    }
}

// Check status periodically to kick banned users instantly from active calls
function startBanStatusHeartbeat() {
    setInterval(async () => {
        // Only run check if the user is actively in a call (has a currentRoomId)
        if (!currentRoomId) return;

        try {
            const response = await fetch('/api/check-status/');
            if (response.redirected && response.url.includes('/banned/')) {
                window.location.href = response.url;
            } else if (response.ok) {
                const data = await response.json();
                if (data.banned) {
                    window.location.href = '/banned/';
                }
            }
        } catch (err) {
            console.error('Ban status check error:', err);
        }
    }, 15000);
}

/* ──────────────────────────────────────────────
   INITIALIZE
   ────────────────────────────────────────────── */
async function initialize() {
    log('Initializing');
    startBanStatusHeartbeat();
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

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.ontrack = (event) => {
            log('pc.ontrack: remote stream received', event.streams[0]);
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
            remoteVideo.play().catch(e => console.error("Error playing remote video:", e));
        };

        localVideo.srcObject = localStream;
        localVideo.play().catch(e => console.error("Error playing local video:", e));

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
            if (room.creatorId === sessionId || room.joinerId === sessionId) {
                await remove(ref(db, `${path}/${key}`));
            }
        }
    }
}

/* ──────────────────────────────────────────────
   FIND OR CREATE ROOM
   ────────────────────────────────────────────── */
async function findOrCreateRoom() {
    if (isMatching) {
        log('findOrCreateRoom already in progress, ignoring duplicate call.');
        return;
    }
    isMatching = true;
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
            // Filter rooms where we aren't the creator and exclude immediate previous peer
            const candidateRooms = Object.entries(rooms)
                .filter(([_, room]) => {
                    const isSelf = room.creatorId === sessionId || (djangoUserId && room.creatorDjangoId === djangoUserId);
                    const isLastPeer = room.creatorId === lastPeerSessionId || (lastPeerDjangoId && room.creatorDjangoId === lastPeerDjangoId);
                    return !isSelf && !isLastPeer;
                })
                .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));

            for (const [roomId, rData] of candidateRooms) {
                updateStatus('Found a stranger! Connecting…');
                const roomRef = ref(db, `rooms/${roomId}`);

                try {
                    // Claim the room atomically
                    const transactionResult = await runTransaction(roomRef, (currentVal) => {
                        if (currentVal) {
                            if (currentVal.status === 'waiting') {
                                currentVal.status = 'full';
                                currentVal.joinerId = sessionId;
                                currentVal.joinerDjangoId = djangoUserId;
                                return currentVal;
                            }
                        }
                        return; // abort transaction
                    });

                    if (transactionResult.committed) {
                        currentRoomId = roomId;

                        // We successfully claimed this room!
                        // Remove from waiting_rooms
                        await remove(ref(db, `waiting_rooms/${roomId}`));

                        // Register onDisconnect for the joiner to delete the room if they disconnect abruptly
                        try {
                            onDisconnect(roomRef).remove();
                        } catch (disError) {
                            log('onDisconnect setup error:', disError);
                        }

                        const updatedRoomVal = transactionResult.snapshot.val();
                        if (!updatedRoomVal || !updatedRoomVal.offer) {
                            throw new Error('Room offer missing or corrupt.');
                        }

                        peerDjangoUserId = updatedRoomVal.creatorDjangoId;
                        lastPeerDjangoId = peerDjangoUserId;
                        lastPeerSessionId = updatedRoomVal.creatorId;

                        if (peerDjangoUserId) loadPeerStats(peerDjangoUserId);

                        updateStatus('Connecting to stranger…');
                        await startCallAsCallee();
                        return;
                    } else {
                        log(`Failed to claim room ${roomId}: already taken. Trying next candidate...`);
                    }
                } catch (txError) {
                    console.error(`Transaction claim failed for room ${roomId}:`, txError);
                }
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
            creatorId: sessionId,
            creatorDjangoId: djangoUserId,
            status: 'waiting',
            createdAt: timestamp,
            offer: { sdp: offerDescription.sdp, type: offerDescription.type }
        });

        await set(ref(db, `waiting_rooms/${currentRoomId}`), {
            creatorId: sessionId,
            creatorDjangoId: djangoUserId,
            status: 'waiting',
            createdAt: timestamp
        });

        // Set up onDisconnect for the room and waiting room refs
        try {
            onDisconnect(newRoomRef).remove();
            onDisconnect(ref(db, `waiting_rooms/${currentRoomId}`)).remove();
        } catch (disError) {
            log('onDisconnect setup error:', disError);
        }

        await startCallAsCaller();
    } catch (error) {
        console.error("findOrCreateRoom error:", error);
        updateStatus(`Error: ${error.message}`);
        loadingSpinner.classList.add('hidden');
        nextButton.disabled = false;
        if (currentRoomId) await cleanup();
        throw error;
    } finally {
        isMatching = false;
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

    let hasSetRemoteDescription = false;
    onValue(roomRef, async (snapshot) => {
        const data = snapshot.val();
        if (!hasSetRemoteDescription && data?.answer) {
            hasSetRemoteDescription = true;
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

                peerDjangoUserId = data.joinerDjangoId;
                lastPeerDjangoId = peerDjangoUserId;
                lastPeerSessionId = data.joinerId;

                if (peerDjangoUserId) loadPeerStats(peerDjangoUserId);

                updateStatus('Stranger connected!');
                loadingSpinner.classList.add('hidden');
                nextButton.disabled = false;
                monitorRoomStatus();
                startModeration();
            } catch (err) {
                hasSetRemoteDescription = false;
                console.error("setRemoteDescription error:", err);
            }
        }
    });

    const addedCalleeCandidates = new Set();
    onValue(ref(db, `rooms/${currentRoomId}/calleeCandidates`), (snapshot) => {
        snapshot.forEach(child => {
            if (!addedCalleeCandidates.has(child.key)) {
                addedCalleeCandidates.add(child.key);
                pc.addIceCandidate(new RTCIceCandidate(child.val())).catch(e => log('ICE error:', e));
            }
        });
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

        const addedCallerCandidates = new Set();
        onValue(ref(db, `rooms/${currentRoomId}/callerCandidates`), (snapshot) => {
            snapshot.forEach(child => {
                if (!addedCallerCandidates.has(child.key)) {
                    addedCallerCandidates.add(child.key);
                    pc.addIceCandidate(new RTCIceCandidate(child.val())).catch(e => log('ICE error:', e));
                }
            });
        });

        updateStatus('Connected to stranger!');
        loadingSpinner.classList.add('hidden');
        nextButton.disabled = false;
        monitorRoomStatus();
        startModeration();
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
            onDisconnect(ref(db, `rooms/${currentRoomId}`)).cancel();
            onDisconnect(ref(db, `waiting_rooms/${currentRoomId}`)).cancel();
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
        pc = createPeerConnection();
    }

    if (remoteVideo?.srcObject) remoteVideo.srcObject = null;

    currentRoomId = null;
    isMatching = false;
    peerDjangoUserId = null;
    clearPeerStats();
    resetMediaButtons();
    stopModeration();
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

            // Golden glow on both panels
            triggerConnectGlow();
            // Sparkle animation
            triggerSparkles();
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
   CONNECT GOLDEN GLOW + SPARKLE
   ────────────────────────────────────────────── */
function triggerConnectGlow() {
    const panels = document.querySelectorAll('.video-panel');
    panels.forEach(p => {
        p.classList.add('connect-glow');
    });
    setTimeout(() => {
        panels.forEach(p => p.classList.remove('connect-glow'));
    }, 2500);
}

function triggerSparkles() {
    const canvas = document.getElementById('sparkleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const PARTICLE_COUNT = 80;
    const DURATION = 2000;

    // Create particles from center of each panel
    const panels = document.querySelectorAll('.video-panel');
    panels.forEach(panel => {
        const rect = panel.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        for (let i = 0; i < PARTICLE_COUNT / 2; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 4;
            particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 1.5 + Math.random() * 3,
                alpha: 1,
                decay: 0.01 + Math.random() * 0.02,
                color: Math.random() > 0.5
                    ? `rgba(251, 191, 36, `  // gold
                    : `rgba(255, 215, 0, `    // brighter gold
            });
        }
    });

    const startTime = performance.now();

    function animate(now) {
        const elapsed = now - startTime;
        if (elapsed > DURATION) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.02; // gravity
            p.alpha -= p.decay;
            if (p.alpha <= 0) return;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color + p.alpha + ')';
            ctx.shadowBlur = 8;
            ctx.shadowColor = p.color + '0.6)';
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
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
            <span class="badge-stat">🗿 ${stats.aura_points}</span>
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
    // Clear any star glow from remote panel
    const rp = document.getElementById('remoteVideoContainer');
    if (rp) {
        for (let i = 1; i <= 5; i++) rp.classList.remove('star-glow-' + i);
    }
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
        localPanel = document.getElementById('localPanel');
        remotePanel = document.getElementById('remoteVideoContainer');

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
            if (peerDjangoUserId && reportedPeersToday.has(peerDjangoUserId)) {
                showToast('You have already reported this user today.', 'warning');
                return;
            }
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

            if (reportedPeersToday.has(peerDjangoUserId)) {
                showToast('You have already reported this user today.', 'warning');
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
                    reportedPeersToday.add(peerDjangoUserId);
                } else {
                    showToast(data.error || 'Failed to submit report.', 'error');
                }
            } catch (error) {
                console.error('Report error:', error);
                showToast('Failed to submit report.', 'error');
            }
        };

        /* ── Inline star-rating (inside remote container) ── */
        const inlineStars = document.querySelectorAll('.inline-star');
        const remoteContainer = document.getElementById('remoteVideoContainer');

        // Clear all star glow classes
        function clearStarGlow() {
            if (!remoteContainer) return;
            for (let i = 1; i <= 5; i++) {
                remoteContainer.classList.remove('star-glow-' + i);
            }
        }

        // Hover: highlight all stars up to the hovered one + glow container
        inlineStars.forEach((star, idx) => {
            star.addEventListener('mouseenter', () => {
                // Highlight all stars up to this one
                inlineStars.forEach((s, i) => {
                    s.classList.toggle('star-active', i <= idx);
                });
                // Apply glow intensity to container
                clearStarGlow();
                if (remoteContainer) {
                    remoteContainer.classList.add('star-glow-' + (idx + 1));
                }
            });
        });

        // When mouse leaves the star rating area, clear everything
        const starRatingContainer = document.getElementById('inlineStarRating');
        if (starRatingContainer) {
            starRatingContainer.addEventListener('mouseleave', () => {
                inlineStars.forEach(s => s.classList.remove('star-active'));
                clearStarGlow();
            });
        }

        // Click: submit rating immediately
        inlineStars.forEach((star) => {
            star.addEventListener('click', async () => {
                const rating = parseInt(star.getAttribute('data-rating'));

                if (!peerDjangoUserId) {
                    showToast('Cannot identify stranger.', 'error');
                    return;
                }

                if (ratedPeersToday.has(peerDjangoUserId)) {
                    showToast('You have already rated this user today. Try again tomorrow.', 'warning');
                    return;
                }

                // Flash confirmed state
                inlineStars.forEach((s, i) => {
                    s.classList.toggle('star-confirmed', i < rating);
                    s.classList.toggle('star-active', i < rating);
                });

                // Apply max glow for the confirmed rating
                clearStarGlow();
                if (remoteContainer) {
                    remoteContainer.classList.add('star-glow-' + rating);
                }

                try {
                    const response = await fetch('/submit-rating/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                        body: JSON.stringify({ rated_user_id: peerDjangoUserId, rate_points: rating })
                    });
                    const data = await response.json();
                    if (response.ok && data.success) {
                        showToast(`Rated ${rating} star${rating > 1 ? 's' : ''} ✨`, 'success');
                        ratedPeersToday.add(peerDjangoUserId);
                    } else {
                        showToast(data.error || 'Failed to submit rating.', 'error');
                    }
                } catch (error) {
                    console.error('Rating error:', error);
                    showToast('Failed to submit rating.', 'error');
                }

                // Reset after a moment
                setTimeout(() => {
                    inlineStars.forEach(s => {
                        s.classList.remove('star-confirmed');
                        s.classList.remove('star-active');
                    });
                    clearStarGlow();
                }, 1200);
            });
        });

        log('All handlers attached');

        await checkMediaPermissions();
        await initialize();
        await loadNSFWModel();
        log('Initialization complete');
    } catch (error) {
        console.error('Init error:', error);
        if (statusEl) statusEl.textContent = 'Failed to initialize. Please refresh.';
    }
});


